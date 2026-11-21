'use strict';
/**
 * A teacher whose 24 h window is closed still gets the coaching quiz — on the report we already send.
 *
 * Before: processOffer skipped a closed window before its claim, so the skip left no row, and the report template
 * (share_dc_report_v1) carried no way to ask for the quiz. Now, with `quiz_offer_closed_window` on:
 *   - the skip writes the session's quizzes row (skipped / window_closed / held_path);
 *   - the report goes as the quiz sibling template, one QUICK_REPLY whose payload is tqr_<sessionId>;
 *   - the tap is the yes: the held row is revived, digested, and goes straight to the quiz (no second ask).
 * Switch off = byte-for-byte the old behaviour.
 *
 * Real modules: transcript-quiz-offer, closed-window-offer, report-window-send, share-send. Mocked: the database
 * (an in-memory table fake), the WhatsApp boundary, the queue, the digest model call, logging.
 */
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn(),
  sendReaction: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
  introShownCount: jest.fn().mockResolvedValue(5),
  markVideoShown: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const QuizDelivery = require('../../bot/shared/services/quiz/quiz-delivery.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const Queue = require('../../bot/shared/services/queue');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
const { sendReportByTemplateIfWindowClosed } = require('../../bot/shared/services/coaching/report-window-send');
const { sendShare } = require('../../bot/shared/services/share-send.service');

const SID = '0c0ac0ac-1111-4111-8111-000000000001';
const UID = 'u0000000-2222-4222-8222-000000000002';
const PHONE = '920000000001';
const OTHER = '920000000099';
const QUIZ_TEMPLATE = 'share_dc_report_quiz_v1';
const HELD = '9a000000-0000-4000-8000-0000000000aa';

const SESSION = {
  id: SID, user_id: UID, status: 'completed', observation_type: null,
  transcript_text: 'x'.repeat(2000), transcript_language: 'en', analysis_data: {}, created_at: '2026-11-20T08:00:00Z',
  users: { id: UID, name: 'T', phone_number: PHONE, preferred_language: 'en' },
};

/** A table-aware fake: eq/in filters really filter; insert honours the one-transcript-quiz-per-session index. */
let db;
function fakeFrom(table) {
  const filters = [];
  let op = 'select';
  let payload = null;
  const rows = () => (db[table] || []).filter((r) => filters.every(([k, v, kind]) => {
    const val = k.includes('->>') ? (r[k.split('->>')[0]] || {})[k.split('->>')[1]] : r[k];
    return kind === 'in' ? v.includes(val) : val === v;
  }));
  const run = () => {
    if (op === 'insert') {
      const dup = table === 'quizzes' && (db.quizzes || []).some((r) => r.coaching_session_id === payload.coaching_session_id
        && r.quiz_source === 'transcript' && payload.quiz_source === 'transcript');
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate' } };
      const row = { id: `9a000000-0000-4000-8000-${String((db.quizzes || []).length + 1).padStart(12, '0')}`, ...payload };
      (db[table] = db[table] || []).push(row);
      return { data: [row], error: null };
    }
    if (op === 'update') {
      const hit = rows();
      hit.forEach((r) => Object.assign(r, payload));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    return { data: rows(), error: null };
  };
  const chain = {
    select: () => chain,
    insert: (row) => { op = 'insert'; payload = row; return chain; },
    update: (patch) => { op = 'update'; payload = patch; return chain; },
    eq: (k, v) => { filters.push([k, v, 'eq']); return chain; },
    in: (k, v) => { filters.push([k, v, 'in']); return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => { const r = run(); return { data: (r.data || [])[0] || null, error: r.error }; },
    single: async () => { const r = run(); return { data: (r.data || [])[0] || null, error: r.error }; },
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

function switchRow(value) {
  return value === undefined ? [] : [{ key: 'quiz_offer_closed_window', value }];
}

beforeEach(() => {
  jest.clearAllMocks();
  // absent on the base (the red run): the switch cache only exists with the fix
  try { require('../../bot/shared/services/quiz/closed-window-offer')._resetCache(); } catch (_) { /* red run */ }
  db = { coaching_sessions: [{ ...SESSION }], users: [{ ...SESSION.users }], quizzes: [], app_settings: [] };
  supabase.from.mockImplementation((t) => {
    if (t === 'coaching_sessions') {
      // the session read joins users; the fake returns the joined shape it was seeded with
      return fakeFrom('coaching_sessions');
    }
    return fakeFrom(t);
  });
  Digest.run.mockResolvedValue({
    digest: { confidence: 0.9, slos: ['a', 'b'], language_of_instruction: 'en', subject: 'science' },
    grade: 3, model: 'm', costUsd: 0,
  });
  QuizDelivery._hasOpenMessageWindow.mockResolvedValue(false);
});

const offerButtonsSent = () => WhatsAppService.sendInteractiveButtons.mock.calls
  .concat(WhatsAppService.sendVideoWithButtons.mock.calls)
  .some((c) => JSON.stringify(c).includes('tq_yes_'));

describe('the offer job, window closed', () => {
  test('switch off → exactly as before: no row, no send, the old event', async () => {
    const out = await Offer.processOffer(SID, { phone: PHONE });
    expect(out).toEqual({ skipped: 'window_closed' });
    expect(db.quizzes).toHaveLength(0);
    expect(offerButtonsSent()).toBe(false);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.skipped', { coachingSessionId: SID, reason: 'window_closed' });
  });

  test('switch on → the skip leaves the session\'s row: skipped, window_closed, held_path none', async () => {
    db.app_settings = switchRow({ trace: true });
    const out = await Offer.processOffer(SID, { phone: PHONE });
    expect(out).toMatchObject({ skipped: 'window_closed', heldPath: 'none' });
    expect(db.quizzes).toHaveLength(1);
    expect(db.quizzes[0]).toMatchObject({
      coaching_session_id: SID, teacher_id: UID, quiz_source: 'transcript', status: 'skipped',
      meta: expect.objectContaining({ skip_reason: 'window_closed', held_path: 'none' }),
    });
    expect(Digest.run).not.toHaveBeenCalled();
    expect(offerButtonsSent()).toBe(false);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.skipped',
      { coachingSessionId: SID, reason: 'window_closed', held_path: 'none' });
  });

  test('a held row is revived when a later job finds the window open, not refused as already claimed', async () => {
    db.app_settings = switchRow({ trace: true });
    await Offer.processOffer(SID, { phone: PHONE });
    QuizDelivery._hasOpenMessageWindow.mockResolvedValue(true);
    const out = await Offer.processOffer(SID, { phone: PHONE });
    expect(out).toMatchObject({ ok: true, quizId: db.quizzes[0].id });
    expect(db.quizzes).toHaveLength(1);
    expect(db.quizzes[0].status).toBe('offered');
    expect(offerButtonsSent()).toBe(true);
  });
});

describe('the report template carries "Make a quiz" (real share-send; Meta mocked)', () => {
  const shareDeps = () => ({
    templateName: () => 'share_dc_report_v1',
    user: async () => ({ id: UID, phone_number: PHONE, preferred_language: 'en' }),
    item: async () => ({ kind: 'dc', imageUrl: 'https://r2.example/report.png', title: 'Plants', grade: 3, subject: 'Science', itemRef: `report:${SID}` }),
    now: () => new Date('2026-11-21T10:00:00Z'),
    wait: async () => {},
    sendTemplate: (...a) => WhatsAppService.sendTemplate(...a),
  });
  const send = () => sendReportByTemplateIfWindowClosed({ phone: PHONE, userId: UID, sessionId: SID }, {
    windowOpen: async () => false,
    sendShare: (req) => sendShare(req, shareDeps()),
  });

  test('switch with report_template → the quiz sibling goes, one quick reply tqr_<session>, and the row is held as template', async () => {
    db.app_settings = switchRow({ report_template: QUIZ_TEMPLATE });
    WhatsAppService.sendTemplate.mockResolvedValue(true);
    expect(await send()).toBe('template');
    expect(WhatsAppService.sendTemplate).toHaveBeenCalledTimes(1);
    const [to, name, lang, components] = WhatsAppService.sendTemplate.mock.calls[0];
    expect([to, name, lang]).toEqual([PHONE, QUIZ_TEMPLATE, 'en']);
    expect(components[components.length - 1]).toEqual({
      type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `tqr_${SID}` }],
    });
    expect(db.quizzes).toHaveLength(1);
    expect(db.quizzes[0]).toMatchObject({ status: 'skipped', meta: expect.objectContaining({ skip_reason: 'window_closed', held_path: 'template' }) });
    expect(logEvent).toHaveBeenCalledWith('coaching.report.quiz_template_sent', expect.objectContaining({ sessionId: SID }));
  });

  test('then the offer job keeps held_path template (the report already carried the button)', async () => {
    db.app_settings = switchRow({ report_template: QUIZ_TEMPLATE });
    WhatsAppService.sendTemplate.mockResolvedValue(true);
    await send();
    const out = await Offer.processOffer(SID, { phone: PHONE });
    expect(out).toMatchObject({ skipped: 'window_closed', heldPath: 'template' });
    expect(db.quizzes).toHaveLength(1);
  });

  test('quiz sibling refused → the plain report template, exactly as today; nothing held as template', async () => {
    db.app_settings = switchRow({ report_template: QUIZ_TEMPLATE });
    WhatsAppService.sendTemplate.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await send()).toBe('template');
    expect(WhatsAppService.sendTemplate.mock.calls.map((c) => c[1])).toEqual([QUIZ_TEMPLATE, 'share_dc_report_v1']);
    expect(JSON.stringify(WhatsAppService.sendTemplate.mock.calls[1][3])).not.toContain('quick_reply');
    expect(db.quizzes).toHaveLength(0);
  });

  test('switch off → the plain report template, and the session is never read for a button', async () => {
    WhatsAppService.sendTemplate.mockResolvedValue(true);
    expect(await send()).toBe('template');
    expect(WhatsAppService.sendTemplate.mock.calls.map((c) => c[1])).toEqual(['share_dc_report_v1']);
  });
});

describe('the tap', () => {
  test('tqr_<session> from the teacher → the held row is revived, digested, and goes to the quiz: no second ask', async () => {
    db.app_settings = switchRow({ report_template: QUIZ_TEMPLATE });
    db.quizzes.push({ id: HELD, coaching_session_id: SID, teacher_id: UID, quiz_source: 'transcript', status: 'skipped',
      meta: { step: 'skipped', skip_reason: 'window_closed', held_path: 'template' } });
    expect(await Offer.handleReportQuizTap(`tqr_${SID}`, PHONE)).toBe(true);
    expect(Digest.run).toHaveBeenCalledTimes(1);
    expect(QuizDelivery._hasOpenMessageWindow).not.toHaveBeenCalled();
    expect(offerButtonsSent()).toBe(false);
    const row = db.quizzes.find((r) => r.id === HELD);
    expect(row.meta.via).toBe('report_button');
    // the yes: straight to generating, or the language ask for a subject that needs one — never the offer again
    expect(row.status === 'generating' || row.meta.step === 'awaiting_language').toBe(true);
    if (row.status === 'generating') {
      expect(Queue.queueJob).toHaveBeenCalledWith(HELD, 'quiz_generate', expect.objectContaining({ quizId: HELD }), expect.anything());
    }
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.report_tap', expect.objectContaining({ coachingSessionId: SID, outcome: 'accepted' }));
  });

  test('a tap before the offer job ran (no row yet) → claims and goes to the quiz', async () => {
    db.app_settings = switchRow({ report_template: QUIZ_TEMPLATE });
    expect(await Offer.handleReportQuizTap(`tqr_${SID}`, PHONE)).toBe(true);
    expect(db.quizzes).toHaveLength(1);
    expect(db.quizzes[0].status === 'generating' || db.quizzes[0].meta.step === 'awaiting_language').toBe(true);
    expect(offerButtonsSent()).toBe(false);
  });

  test('a tap from a number that is not the session\'s teacher → nothing is made', async () => {
    expect(await Offer.handleReportQuizTap(`tqr_${SID}`, OTHER)).toBe(true);
    expect(Digest.run).not.toHaveBeenCalled();
    expect(db.quizzes).toHaveLength(0);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.report_tap', { coachingSessionId: SID, outcome: 'not_owner' });
  });

  test('a tapped teacher whose transcript cannot make a quiz hears why (the /quiz copy), never silence', async () => {
    db.app_settings = switchRow({ report_template: QUIZ_TEMPLATE });
    Digest.run.mockResolvedValue({ digest: { confidence: 0.2, slos: ['a'], language_of_instruction: 'en', subject: 'science' }, grade: 3, model: 'm', costUsd: 0 });
    await Offer.handleReportQuizTap(`tqr_${SID}`, PHONE);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][0]).toBe(PHONE);
  });

  test('anything that is not tqr_<uuid> is not ours', async () => {
    expect(await Offer.handleReportQuizTap('tqr_nope', PHONE)).toBe(false);
    expect(await Offer.handleReportQuizTap('Make a quiz', PHONE)).toBe(false);
  });
});
