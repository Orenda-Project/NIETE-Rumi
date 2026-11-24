'use strict';
/**
 * bd-8267ps (eval #239): about half of teachers' quizzes never got a children's link. Every quiz that is WRITTEN
 * gets one; the gap is recording quizzes left at 'offered' because the quiz is only written after the teacher taps
 * "yes". With `app_settings.quiz_offer_auto` = true, the offer job goes straight down the yes path the report's
 * "Make a quiz" tap already takes: the quiz is written, and the hand-off mints its web (in-app browser) link.
 * Switch off, missing or unreadable = the Yes / Not now buttons, exactly as before.
 *
 * Real: transcript-quiz-offer, transcript-quiz-auto, closed-window-offer. Mocked: database (in-memory fake),
 * WhatsApp, queue, digest model call, logging.
 */
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
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

const SID = '0c0ac0ac-1111-4111-8111-000000000001';
const UID = 'u0000000-2222-4222-8222-000000000002';
const PHONE = '920000000001';
const SESSION = {
  id: SID, user_id: UID, status: 'completed', observation_type: null,
  transcript_text: 'x'.repeat(2000), transcript_language: 'en', analysis_data: {}, created_at: '2026-11-20T08:00:00Z',
  users: { id: UID, name: 'T', phone_number: PHONE, preferred_language: 'en' },
};

let db;
let settingsFail = false;
function fakeFrom(table) {
  const filters = [];
  let op = 'select';
  let payload = null;
  const rows = () => (db[table] || []).filter((r) => filters.every(([k, v, kind]) => (kind === 'in' ? v.includes(r[k]) : r[k] === v)));
  const run = () => {
    if (table === 'app_settings' && settingsFail) return { data: null, error: { message: 'down' } };
    if (op === 'insert') {
      const dup = table === 'quizzes' && db.quizzes.some((r) => r.coaching_session_id === payload.coaching_session_id);
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate' } };
      const row = { id: `9a000000-0000-4000-8000-${String(db.quizzes.length + 1).padStart(12, '0')}`, ...payload };
      db[table].push(row);
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

const autoRow = (value) => [{ key: 'quiz_offer_auto', value }];
const offerButtonsSent = () => WhatsAppService.sendInteractiveButtons.mock.calls
  .concat(WhatsAppService.sendVideoWithButtons.mock.calls)
  .some((c) => JSON.stringify(c).includes('tq_yes_'));

beforeEach(() => {
  jest.clearAllMocks();
  settingsFail = false;
  try { require('../../bot/shared/services/quiz/transcript-quiz-auto')._resetCache(); } catch (_) { /* red run */ }
  try { require('../../bot/shared/services/quiz/closed-window-offer')._resetCache(); } catch (_) { /* older base */ }
  db = { coaching_sessions: [{ ...SESSION }], users: [{ ...SESSION.users }], quizzes: [], app_settings: [] };
  supabase.from.mockImplementation((t) => fakeFrom(t));
  Digest.run.mockResolvedValue({
    digest: { confidence: 0.9, slos: ['a', 'b'], language_of_instruction: 'en', subject: 'science' },
    grade: 3, model: 'm', costUsd: 0,
  });
  QuizDelivery._hasOpenMessageWindow.mockResolvedValue(true);
});

describe('quiz_offer_auto on: the recording quiz is written without waiting for a tap', () => {
  test('window open → no Yes / Not now buttons; the row goes to generating and the quiz job is queued', async () => {
    db.app_settings = autoRow(true);
    const out = await Offer.processOffer(SID, { phone: PHONE, source: 'self' });
    expect(out).toMatchObject({ ok: true, auto: true });
    expect(offerButtonsSent()).toBe(false);
    expect(db.quizzes).toHaveLength(1);
    const row = db.quizzes[0];
    expect(row.status).toBe('generating');
    expect(row.meta.via).toBe('auto');
    expect(Queue.queueJob).toHaveBeenCalledWith(row.id, 'quiz_generate', expect.objectContaining({ quizId: row.id }), expect.anything());
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.offered', expect.objectContaining({ quizId: row.id, via: 'auto' }));
  });

  test('a subject that would ask "which language?" is not asked: the rule language is written', async () => {
    db.app_settings = autoRow(true);
    await Offer.processOffer(SID, { phone: PHONE });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(db.quizzes[0].meta.step).not.toBe('awaiting_language');
    expect(db.quizzes[0].language).toBe('en');
  });

  test('window closed → still skipped as before (the hand-off cannot reach her; the report template path stays)', async () => {
    db.app_settings = autoRow(true);
    QuizDelivery._hasOpenMessageWindow.mockResolvedValue(false);
    const out = await Offer.processOffer(SID, { phone: PHONE });
    expect(out).toMatchObject({ skipped: 'window_closed' });
    expect(Digest.run).not.toHaveBeenCalled();
    expect(Queue.queueJob).not.toHaveBeenCalled();
  });

  test('a lesson the digest cannot quiz is skipped quietly: nothing is sent to a teacher who never asked', async () => {
    db.app_settings = autoRow(true);
    Digest.run.mockResolvedValue({ digest: { confidence: 0.2, slos: ['a'], language_of_instruction: 'en', subject: 'science' }, grade: 3, model: 'm', costUsd: 0 });
    const out = await Offer.processOffer(SID, { phone: PHONE });
    expect(out).toMatchObject({ skipped: 'low_confidence' });
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(Queue.queueJob).not.toHaveBeenCalled();
  });
});

describe('quiz_offer_auto off, missing or unreadable: the offer buttons, exactly as before', () => {
  test.each([
    ['missing', () => { db.app_settings = []; }],
    ['false', () => { db.app_settings = autoRow(false); }],
    ['the string "true" (only JSON true counts)', () => { db.app_settings = autoRow('true'); }],
    ['unreadable', () => { settingsFail = true; }],
  ])('%s → Yes / Not now sent, row offered, nothing queued', async (_label, arrange) => {
    arrange();
    const out = await Offer.processOffer(SID, { phone: PHONE });
    expect(out).toEqual({ ok: true, quizId: db.quizzes[0].id });
    expect(offerButtonsSent()).toBe(true);
    expect(db.quizzes[0].status).toBe('offered');
    expect(Queue.queueJob).not.toHaveBeenCalled();
  });
});

describe('the switch reader', () => {
  test('reads once per 30 s; a failed read is not held', async () => {
    const Auto = require('../../bot/shared/services/quiz/transcript-quiz-auto');
    settingsFail = true;
    expect(await Auto.on(1000)).toBe(false);
    settingsFail = false;
    db.app_settings = autoRow(true);
    expect(await Auto.on(2000)).toBe(true);
    db.app_settings = autoRow(false);
    expect(await Auto.on(2000 + 29999)).toBe(true);
    expect(await Auto.on(2000 + 30000)).toBe(false);
  });
});
