'use strict';
/**
 * The observation flow says the same things in fewer WhatsApp messages.
 *
 * Every message delivered is billed. In one completed observation the coach got
 * several pairs of bubbles that are read together and carry no decision between
 * them; each pair is now one message, with every word kept:
 *
 *   - the debrief guide + "When you're with the teacher: open the voice recorder…"
 *     → one text (both under WhatsApp's 4,096 code points);
 *   - the coach's praise line + the coach card → the card, with the praise line
 *     above the card's closing line in its caption;
 *   - the report image + its companion text ("From {coach} … Your commitment …")
 *     → the image, the companion in its caption — for the teacher AND for the
 *     coach's preview, which therefore still matches what the teacher gets;
 *   - "📨 Sending the report to the teacher now…" → a 📨 reaction on the coach's
 *     "Send now" tap (every outcome already sends its own message).
 *
 * Wherever a merged body would overrun its cap, the old separate messages are
 * kept — asserted below, not assumed.
 *
 * Drives the real observe services; only the network boundary is stubbed: the
 * Supabase client, the WhatsApp sender, the redis cache, the LLM, the queue
 * producer, R2, and the Playwright card renderer.
 */
const SESSION_ID = 'sess-1';
const COACH_PHONE = '923330000001';
const TEACHER_PHONE = '923001234567';
const PNG = Buffer.from('png');

let mockTables;
let mockUpdates;
let mockRedis;

jest.mock('../../bot/shared/config/supabase', () => {
  const { chain } = require('../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain(() => ({ data: (mockTables[table] || (() => null))(), error: null }));
      // Writes are recorded and answered without touching the row stub.
      const record = (op) => (payload) => { mockUpdates.push({ table, op, payload }); return c; };
      return new Proxy(c, {
        get(target, prop) {
          if (prop === 'update' || prop === 'insert' || prop === 'upsert') return record(prop);
          return target[prop];
        },
      });
    }),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (k) => (mockRedis.has(k) ? mockRedis.get(k) : null)),
  set: jest.fn(async (k, v) => { mockRedis.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, _t, v) => { mockRedis.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
  del: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
  setNX: jest.fn().mockResolvedValue(true),
  isAvailable: () => true,
}));
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  showTypingIndicator: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn().mockRejectedValue(new Error('LLM unavailable in test — fallback guide')),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn().mockResolvedValue(true),
  queueObserveDebrief: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('png')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
// Playwright is the render boundary. The real renderer returns null for a harmful
// debrief (no celebration card) — mirrored here so that path stays testable.
jest.mock('../../bot/shared/services/observe/observe-coach-card', () => ({
  renderCoachCard: jest.fn(async (fb) => (fb && fb.rubric && fb.rubric.disparaged_teacher ? null : Buffer.from('png'))),
}));

const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const cp = (s) => [...String(s)].length;
const texts = (to) => mockWa.sendMessage.mock.calls.filter(([t]) => !to || t === to).map(([, b]) => String(b));

const COACH = { id: 'coach-1', phone_number: COACH_PHONE, preferred_language: 'en', first_name: 'Sana' };

function rubric(over = {}) {
  return {
    disparaged_teacher: false, opened_with_specific_praise: true, anchored_in_real_moment: true,
    asked_and_waited: true, one_improvement_only: true, moves_not_teacher: true, elicited_if_then: true,
    ...over,
  };
}
const goodFeedback = (over = {}) => ({
  praise_line: 'You opened warmly and let the teacher think.',
  wins: [{ behaviour: 'Opened with specific praise', evidence: 'you named the pair work' }],
  try: { move: 'Let the teacher name the next step', evidence: 'you offered the plan', instead: 'ask what they will try, then wait' },
  reflection_question: 'What will you do differently next time?',
  value: null,
  rubric: rubric(),
  concern: null,
  ...over,
});

function sessionRow(over = {}) {
  return {
    id: SESSION_ID,
    user_id: 'teacher-1',
    observer_user_id: COACH.id,
    observation_type: 'leader_observation',
    status: 'observer_review_complete',
    debrief_status: 'pending',
    analysis_data: { framework: 'fico' },
    users: { name: 'T', phone_number: TEACHER_PHONE, preferred_language: 'en' },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates = [];
  mockRedis = new Map();
  mockTables = {
    coaching_sessions: () => sessionRow(),
    users: () => COACH,
  };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_REVIEW_MODE = 'off';
});
afterAll(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });

describe('the debrief guide and the recording instruction arrive as ONE message', () => {
  const Debrief = () => require('../../bot/shared/services/observe/observe-debrief.service');

  test.each(['en', 'ur'])('first delivery (%s): one text, guide first, instruction last', async (lang) => {
    const S = observeStrings(lang);
    await Debrief().startDebrief(SESSION_ID, COACH_PHONE, { ...COACH, preferred_language: lang });
    const sent = texts(COACH_PHONE);
    expect(sent).toHaveLength(1);
    expect(sent[0].startsWith('🌱')).toBe(true);
    expect(sent[0].endsWith(S.debrief_record_instruction)).toBe(true);
    expect(cp(sent[0])).toBeLessThanOrEqual(4096);
  });

  test('a double tap re-sends the stored guide + instruction as one message too', async () => {
    const S = observeStrings('en');
    const { renderGuideMessage } = require('../../bot/shared/services/observe/observe-debrief-guide');
    const guide = { intro: 'Hello', steps: [{ title: 'Praise', body: 'Name one moment.' }], outro: 'Private.' };
    // Seeded through observe-state's own setter so the test cannot drift from its key format.
    const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
    await ObserveState.setState(COACH.id, 'awaiting_debrief_audio', { sessionId: SESSION_ID, guide_snapshot: guide });
    await Debrief().startDebrief(SESSION_ID, COACH_PHONE, COACH);
    expect(texts(COACH_PHONE)).toEqual([`${renderGuideMessage(guide, S)}\n\n${S.debrief_record_instruction}`]);
  });

  test('over 4,096 code points: the guide and the instruction stay two messages', async () => {
    const S = observeStrings('en');
    const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
    const huge = { intro: 'x'.repeat(4000), steps: [{ title: 'Praise', body: 'y'.repeat(200) }], outro: 'z' };
    await ObserveState.setState(COACH.id, 'awaiting_debrief_audio', { sessionId: SESSION_ID, guide_snapshot: huge });
    await Debrief().startDebrief(SESSION_ID, COACH_PHONE, COACH);
    const sent = texts(COACH_PHONE);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(S.debrief_record_instruction);
  });
});

describe('the praise line rides on the coach card', () => {
  const Debrief = () => require('../../bot/shared/services/observe/observe-debrief.service');
  const withStoredFeedback = (fb) => {
    mockTables.coaching_sessions = () => sessionRow({
      analysis_data: { framework: 'fico', observer_debrief: { feedback: fb } },
    });
  };

  test.each(['en', 'ur'])('one image whose caption is the praise line, then the closing line (%s)', async (lang) => {
    mockTables.users = () => ({ ...COACH, preferred_language: lang });
    const S = observeStrings(lang);
    const fb = goodFeedback();
    withStoredFeedback(fb);
    await Debrief().processDebriefRecording(SESSION_ID, { from: COACH_PHONE });
    expect(mockWa.sendImageFromBuffer).toHaveBeenCalledTimes(1);
    const [to, png, caption] = mockWa.sendImageFromBuffer.mock.calls[0];
    expect(to).toBe(COACH_PHONE);
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(caption).toBe(`${fb.praise_line}\n\n${S.coach_card_closing}`);
    // The praise line is no longer its own bubble.
    expect(texts(COACH_PHONE)).not.toContain(fb.praise_line);
    // Delivery still completes: the debrief is marked done and the send offer follows.
    expect(mockUpdates.some((u) => u.payload && u.payload.debrief_status === 'done')).toBe(true);
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalled();
  });

  test('the harmful-debrief path is unchanged: two texts, no card', async () => {
    const S = observeStrings('en');
    const fb = goodFeedback({
      rubric: rubric({ disparaged_teacher: true }),
      concern: { what_happened: 'a', why_it_matters: 'b', instead: 'c' },
    });
    withStoredFeedback(fb);
    await Debrief().processDebriefRecording(SESSION_ID, { from: COACH_PHONE });
    expect(mockWa.sendImageFromBuffer).not.toHaveBeenCalled();
    const sent = texts(COACH_PHONE);
    expect(sent[0]).toBe(S.coach_concern_opener);
    expect(sent).toHaveLength(2);
  });

  test('if the card image is refused, the praise and the text card both still arrive', async () => {
    const fb = goodFeedback();
    withStoredFeedback(fb);
    mockWa.sendImageFromBuffer.mockResolvedValueOnce(false);
    await Debrief().processDebriefRecording(SESSION_ID, { from: COACH_PHONE });
    const sent = texts(COACH_PHONE);
    expect(sent[0]).toBe(fb.praise_line);
    expect(sent).toHaveLength(2);
  });

  test('a praise line too long for a caption keeps the two-message shape', async () => {
    const S = observeStrings('en');
    const fb = goodFeedback({ praise_line: 'p'.repeat(1100) });
    withStoredFeedback(fb);
    await Debrief().processDebriefRecording(SESSION_ID, { from: COACH_PHONE });
    expect(texts(COACH_PHONE)[0]).toBe(fb.praise_line);
    expect(mockWa.sendImageFromBuffer.mock.calls[0][2]).toBe(S.coach_card_closing);
  });
});

describe('the report image carries its companion text as the caption', () => {
  const Send = () => require('../../bot/shared/services/observe/observe-send.service');
  const CAPTION = 'Your lesson report 🌱 Prepared from Sana\'s visit — with notes from your conversation together.';
  const COMPANION = '📝 *From Sana*\n\nWe talked about pair work.\n\n🌱 *Your commitment*\n_"Ask more why questions"_\n\nWe are proud of your work. We are with you. 💛';
  const withDelivery = (over = {}) => {
    mockTables.coaching_sessions = () => sessionRow({
      analysis_data: {
        framework: 'fico',
        teacher_delivery: {
          status: 'awaiting_teacher_tap', report_key: 'observe-reports/x.png',
          teacher_phone: TEACHER_PHONE, teacher_name: 'Ms Khadija',
          caption: CAPTION, companion_text: COMPANION, ...over,
        },
      },
    });
  };

  test('the teacher gets ONE image: caption, then the companion', async () => {
    withDelivery();
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    const toTeacher = mockWa.sendImageFromBuffer.mock.calls.filter(([t]) => t === TEACHER_PHONE);
    expect(toTeacher).toHaveLength(1);
    expect(toTeacher[0][2]).toBe(`${CAPTION}\n\n${COMPANION}`);
    expect(texts(TEACHER_PHONE)).toEqual([]);
  });

  test('a companion that would overrun 1,024 code points stays a separate text', async () => {
    const long = `📝 *From Sana*\n\n${'w'.repeat(1050)}`;
    withDelivery({ companion_text: long });
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    const toTeacher = mockWa.sendImageFromBuffer.mock.calls.filter(([t]) => t === TEACHER_PHONE);
    expect(toTeacher[0][2]).toBe(CAPTION);
    expect(texts(TEACHER_PHONE)).toEqual([long]);
  });

  test('no companion (notes failed to extract): the image with its caption, as before', async () => {
    withDelivery({ companion_text: null });
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    const toTeacher = mockWa.sendImageFromBuffer.mock.calls.filter(([t]) => t === TEACHER_PHONE);
    expect(toTeacher[0][2]).toBe(CAPTION);
    expect(texts(TEACHER_PHONE)).toEqual([]);
  });
});

describe('"Send now" is acknowledged with a reaction, not a "sending now" text', () => {
  const Send = () => require('../../bot/shared/services/observe/observe-send.service');

  test('with the tap\'s message id: a 📨 reaction on it, and no text', async () => {
    const S = observeStrings('en');
    await Send().handleSendConfirm(SESSION_ID, COACH_PHONE, COACH, { messageId: 'wamid.tap' });
    expect(mockWa.sendReaction).toHaveBeenCalledWith(COACH_PHONE, 'wamid.tap', '📨');
    expect(texts(COACH_PHONE)).not.toContain(S.send_delivering);
    // The job is still queued — the reaction replaces only the words.
    const Queue = require('../../bot/shared/services/coaching/coaching-job-queue.service');
    expect(Queue.queueObserveTeacherReport).toHaveBeenCalledWith(SESSION_ID, { from: COACH_PHONE, phase: 'deliver' });
  });

  test('without a message id the text is kept — the signal is never dropped silently', async () => {
    const S = observeStrings('en');
    await Send().handleSendConfirm(SESSION_ID, COACH_PHONE, COACH);
    expect(texts(COACH_PHONE)).toContain(S.send_delivering);
  });

  test('a reaction WhatsApp refuses falls back to the text', async () => {
    const S = observeStrings('en');
    mockWa.sendReaction.mockResolvedValueOnce(false);
    await Send().handleSendConfirm(SESSION_ID, COACH_PHONE, COACH, { messageId: 'wamid.tap' });
    expect(texts(COACH_PHONE)).toContain(S.send_delivering);
  });
});

describe('the FICO "saved" line rides on the debrief question', () => {
  const Debrief = () => require('../../bot/shared/services/observe/observe-debrief.service');

  test.each(['en', 'ur'])('one buttons message, the ack above the question (%s)', async (lang) => {
    const S = observeStrings(lang);
    await Debrief().acknowledgeFormSubmitted(COACH_PHONE, SESSION_ID, S);
    expect(texts(COACH_PHONE)).toEqual([]);
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, payload] = mockWa.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(COACH_PHONE);
    expect(payload.body).toBe(`${S.submitted_ack}\n\n${S.debrief_choice_body}`);
    expect(cp(payload.body)).toBeLessThanOrEqual(1024);
    expect(payload.buttons.map((b) => b.id)).toEqual([`observe_debrief_now_${SESSION_ID}`, `observe_debrief_later_${SESSION_ID}`]);
  });

  test('if the buttons are refused, the coach still hears the form was saved', async () => {
    const S = observeStrings('en');
    mockWa.sendInteractiveButtons.mockResolvedValueOnce(false);
    await Debrief().acknowledgeFormSubmitted(COACH_PHONE, SESSION_ID, S);
    expect(texts(COACH_PHONE)).toEqual([S.submitted_ack]);
  });

  test('over 1,024 code points: the ack and the question go separately', async () => {
    const S = { ...observeStrings('en'), debrief_choice_body: 'q'.repeat(1000) };
    await Debrief().acknowledgeFormSubmitted(COACH_PHONE, SESSION_ID, S);
    expect(texts(COACH_PHONE)).toEqual([S.submitted_ack]);
    expect(mockWa.sendInteractiveButtons.mock.calls[0][1].body).toBe(S.debrief_choice_body);
  });

  test('no session id: only the ack, as before', async () => {
    const S = observeStrings('en');
    await Debrief().acknowledgeFormSubmitted(COACH_PHONE, null, S);
    expect(texts(COACH_PHONE)).toEqual([S.submitted_ack]);
    expect(mockWa.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});
