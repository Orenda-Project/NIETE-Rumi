/**
 * Post-coaching micro-survey — "was this useful?", and on a 👎, "what could we do better?".
 *
 * RED FIRST. The service does not exist yet.
 *
 * Shape mirrors the lesson-plan survey deliberately: same 2-button prompt, same
 * ask-a-reason-only-on-👎 rule, same Redis window that intercepts the teacher's next text.
 * Three things are specific to coaching:
 *   - it fires only once the whole session has SETTLED — report AND voice debrief delivered —
 *     so she is rating the thing she actually received, not a half-delivered one;
 *   - it writes onto the metrics row that already exists for the session, so the answer is
 *     traceable to the coaching session and no new table is needed;
 *   - a session with no metrics row still gets asked, and the answer is still stored.
 */
const mockSupabase = { from: jest.fn() };
const mockRedis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
const mockWhatsApp = { sendMessage: jest.fn(), sendInteractiveButtons: jest.fn() };

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const svc = require('../../bot/shared/services/coaching/coaching-feedback.service');

const SESSION = '11111111-2222-3333-4444-555555555555';
const USER = '99999999-8888-7777-6666-555555555555';
const PHONE = '923001234567';

/** Minimal chainable Supabase stub. `rows` is what maybeSingle()/select() resolves to. */
function stubTable(handlers) {
  mockSupabase.from.mockImplementation((table) => {
    const h = handlers[table] || {};
    const chain = {
      select: jest.fn(() => chain),
      update: jest.fn((payload) => { (h.onUpdate || (() => {}))(payload); return chain; }),
      insert: jest.fn((payload) => { (h.onInsert || (() => {}))(payload); return chain; }),
      eq: jest.fn((col, val) => { (h.onEq || (() => {}))(col, val); return chain; }),
      maybeSingle: jest.fn(async () => ({ data: h.row === undefined ? null : h.row, error: null })),
      then: undefined,
    };
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue(true);
  stubTable({});
});

describe('the prompt only goes out once the session has settled', () => {
  test('exports the three entry points the coaching flow needs', () => {
    expect(typeof svc.scheduleFeedbackPrompt).toBe('function');
    expect(typeof svc.handleFeedbackButton).toBe('function');
    expect(typeof svc.handlePendingReason).toBe('function');
  });

  test('sends a two-button prompt carrying the coaching session id', async () => {
    stubTable({ users: { row: { preferred_language: 'en' } } });
    await svc.sendFeedbackPrompt({ coachingSessionId: SESSION, userId: USER, phone: PHONE });
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [phone, payload] = mockWhatsApp.sendInteractiveButtons.mock.calls[0];
    expect(phone).toBe(PHONE);
    expect(payload.buttons).toHaveLength(2);
    for (const b of payload.buttons) {
      expect(b.id).toContain(SESSION);
      expect(b.title.length).toBeLessThanOrEqual(20); // WhatsApp caps button titles
    }
  });

  test('scheduling is a no-op when a required field is missing', () => {
    jest.useFakeTimers();
    svc.scheduleFeedbackPrompt({ coachingSessionId: SESSION, userId: null, phone: PHONE });
    jest.runAllTimers();
    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('the thumb is stored against the coaching session', () => {
  test('ignores a button that belongs to another feature', async () => {
    expect(await svc.handleFeedbackButton(`lp_feedback_yes_${SESSION}`, PHONE)).toBe(false);
    expect(await svc.handleFeedbackButton('some_other_button', PHONE)).toBe(false);
  });

  test('👍 updates the metrics row for THIS session and does not ask for a reason', async () => {
    const updates = []; const filters = [];
    stubTable({
      users: { row: { preferred_language: 'en' } },
      coaching_quality_metrics: {
        row: { id: 'm1' },
        onUpdate: (p) => updates.push(p),
        onEq: (c, v) => filters.push([c, v]),
      },
      coaching_sessions: { row: { id: SESSION, user_id: USER } },
    });

    const handled = await svc.handleFeedbackButton(`coaching_fb_yes_${SESSION}`, PHONE);

    expect(handled).toBe(true);
    expect(updates[0]).toMatchObject({ user_satisfaction_rating: 1 });
    expect(filters).toContainEqual(['coaching_session_id', SESSION]);
    expect(mockWhatsApp.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).not.toHaveBeenCalled();   // no reason window on a positive
  });

  test('👎 stores the thumb AND asks what we could do better', async () => {
    const updates = [];
    stubTable({
      users: { row: { preferred_language: 'en' } },
      coaching_quality_metrics: { row: { id: 'm1' }, onUpdate: (p) => updates.push(p) },
      coaching_sessions: { row: { id: SESSION, user_id: USER } },
    });

    await svc.handleFeedbackButton(`coaching_fb_no_${SESSION}`, PHONE);

    expect(updates[0]).toMatchObject({ user_satisfaction_rating: 0 });
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const [key, value] = mockRedis.set.mock.calls[0];
    expect(key).toContain(USER);
    expect(value).toMatchObject({ coachingSessionId: SESSION });
    const asked = mockWhatsApp.sendMessage.mock.calls.at(-1)[1];
    expect(asked).toMatch(/better|improve/i);
  });
});

describe('the written reason lands on the same row', () => {
  test('a text sent inside the window is stored as user_feedback and clears the window', async () => {
    const updates = []; const filters = [];
    mockRedis.get.mockResolvedValue({ coachingSessionId: SESSION, promptedAt: Date.now() });
    stubTable({
      users: { row: { preferred_language: 'en' } },
      coaching_quality_metrics: {
        row: { id: 'm1' },
        onUpdate: (p) => updates.push(p),
        onEq: (c, v) => filters.push([c, v]),
      },
    });

    const consumed = await svc.handlePendingReason(USER, PHONE, 'the report was too long');

    expect(consumed).toBe(true);
    expect(updates[0]).toMatchObject({ user_feedback: 'the report was too long' });
    expect(filters).toContainEqual(['coaching_session_id', SESSION]);
    expect(mockRedis.del).toHaveBeenCalled();
  });

  test('a text sent with no window open is not consumed', async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await svc.handlePendingReason(USER, PHONE, 'hello')).toBe(false);
    expect(mockWhatsApp.sendMessage).not.toHaveBeenCalled();
  });
});

describe('language', () => {
  test('an Urdu teacher is asked in Urdu', async () => {
    stubTable({ users: { row: { preferred_language: 'ur' } } });
    await svc.sendFeedbackPrompt({ coachingSessionId: SESSION, userId: USER, phone: PHONE });
    const [, payload] = mockWhatsApp.sendInteractiveButtons.mock.calls[0];
    expect(/[؀-ۿ]/.test(payload.body)).toBe(true);
  });
});

describe('the survey is wired to the place the session actually settles', () => {
  const SRC = require('fs').readFileSync(
    require.resolve('../../bot/shared/services/coaching/report-generator.service'), 'utf8');

  test('completeSession schedules the prompt', () => {
    const body = SRC.slice(SRC.indexOf('static async completeSession'));
    expect(body).toContain('scheduleFeedbackPrompt');
  });

  test('it takes the phone from the JOINED users row, not a coaching_sessions column', () => {
    // coaching_sessions has no phone_number column; the session query selects
    // `users!inner(phone_number, ...)`. Reading session.phone_number yields undefined and
    // the survey silently never sends — which is indistinguishable from nobody answering.
    const body = SRC.slice(SRC.indexOf('static async completeSession'));
    expect(body).toMatch(/session\.users\.phone_number/);
    expect(body).not.toMatch(/updatedSession\.phone_number/);
  });

  test('it is scheduled AFTER the metrics row exists, so the answer has a row to land on', () => {
    const body = SRC.slice(SRC.indexOf('static async completeSession'));
    expect(body.indexOf('recordQualityMetrics')).toBeLessThan(body.indexOf('scheduleFeedbackPrompt'));
  });
});

describe('language protocol — the survey strings live in the one catalog', () => {
  const { resolveUx } = jest.requireActual('../../bot/shared/config/ux-strings');
  const KEYS = ['coachingSurveyAsk', 'coachingSurveyYesButton', 'coachingSurveyNoButton',
                'coachingSurveyThanks', 'coachingSurveyAskReason', 'coachingSurveyReasonThanks'];

  test('every survey string resolves in both languages', () => {
    for (const k of KEYS) {
      for (const lang of ['en', 'ur']) {
        const s = resolveUx(k, { language: lang });
        expect(typeof s).toBe('string');
        expect(s.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('the Urdu is actually Urdu, not an English fallback', () => {
    for (const k of KEYS) expect(/[؀-ۿ]/.test(resolveUx(k, { language: 'ur' }))).toBe(true);
  });

  test('button titles fit WhatsApp\'s 20 CODE POINT cap in both languages', () => {
    // Measured in code points, not .length — an emoji is two UTF-16 units and one code point,
    // and an 87-character footer took /language down silently for hours.
    for (const k of ['coachingSurveyYesButton', 'coachingSurveyNoButton']) {
      for (const lang of ['en', 'ur']) {
        expect([...resolveUx(k, { language: lang })].length).toBeLessThanOrEqual(20);
      }
    }
  });

  test('the service holds no inline per-language ternary of its own', () => {
    const src = require('fs').readFileSync(
      require.resolve('../../bot/shared/services/coaching/coaching-feedback.service'), 'utf8');
    expect(src).not.toMatch(/language === 'ur'\s*\?/);
    expect(src).toContain('resolveUx');
  });
});
