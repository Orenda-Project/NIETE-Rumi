'use strict';
/**
 * Hold, never rewrite, at the WhatsApp door. A child whose class link is wa.me (the web quiz off for that teacher, or
 * its settings read failing) starts the quiz in chat: video-quiz.service startSession reads quiz_questions directly,
 * never through the web quiz's loadQuestions, so the hold filter there never saw these rows. With
 * app_settings quiz_key_hold_on_disagree on, startSession passes its rows through the same filter
 * (key-hold-flag shown): a held item (media.key_held, not released) is not asked; every other item is asked in exactly
 * the order it was before. Off, or no held row: the session is what it was.
 *
 * Runs the real startSession (and the first question it sends) on a fake Supabase that, like PostgREST, returns only
 * the columns a select names — so the filter can only work if the select reads media. The sender and WhatsApp are the
 * boundary. Invented fixtures.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
  setNX: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn().mockResolvedValue({ pickerFailed: false }) }));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({ sendScorecard: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');

const SWITCH = 'quiz_key_hold_on_disagree';
const QUIZ = '55555555-5555-4555-8555-0000000000a1';
const SC = '66666666-6666-4666-8666-0000000000a1';
const KID = '77777777-7777-4777-8777-0000000000a1';
const PHONE = '+92300FIXTURE97';
const qid = (n) => `88888888-8888-4888-8888-00000000000${n}`;
const HOLD = { reason: 'blind_solve', verdict: 'disagree', picks: ['dog'] };

// A transcript-style bank, as the DB hands it back (external_id order, which is not sort_order): q3 is held.
const row = (n, sloId, sortOrder, media = {}) => ({
  id: qid(n), quiz_id: QUIZ, external_id: `tq:${QUIZ}:${sloId}:${n}`, sort_order: sortOrder,
  question_text: `Which word is number ${n}?`, option_a: `cat ${n}`, option_b: `dog ${n}`, option_c: `sun ${n}`, option_d: null,
  correct_option: 'A', explanation: `cat ${n} is right.`, option_feedback: null, media, render_pattern: 'P1',
});
const bank = ({ held = true, released = false } = {}) => [
  row(1, 'S2', 1),
  row(2, 'S1', 0),
  row(3, 'S1', 2, held ? { key_held: released ? { ...HOLD, released_at: '2026-11-25T09:30:00.000Z' } : HOLD } : {}),
  row(4, 'S2', 3),
];

let db;
let fake;
/** PostgREST returns the columns a select names, nothing more (the shared fake returns every column). */
function projecting(from) {
  return (t) => {
    const b = from(t);
    let cols = null;
    const select = b.select;
    b.select = (c, o) => { cols = c; select.call(b, c, o); return b; };
    const then = b.then;
    b.then = (res, rej) => then.call(b, (out) => {
      if (!cols || /[*(]|->>/.test(cols) || !out || !out.data) return res(out);
      const keep = cols.split(',').map((x) => x.trim()).filter(Boolean);
      const pick = (r) => Object.fromEntries(keep.filter((k) => k in r).map((k) => [k, r[k]]));
      return res({ ...out, data: Array.isArray(out.data) ? out.data.map(pick) : pick(out.data) });
    }, rej);
    return b;
  };
}
function seed({ hold = true, questions = bank() } = {}) {
  db = {
    app_settings: hold === null ? [] : [{ key: SWITCH, value: hold }],
    quizzes: [{ id: QUIZ, quiz_source: 'lp_v8' }],
    quiz_questions: questions,
    quiz_sessions: [],
    quiz_share_codes: [{ id: SC, quiz_id: QUIZ, code: 'K7Q2MXTRAE', uses_count: 0 }],
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: projecting(fake.from), rpc: fake.rpc });
}
/** A child's class-link run in chat (the wa.me door). */
const start = () => VideoQuiz.startSession({
  phone: PHONE, userId: null, quizId: QUIZ, videoId: null, language: 'en', source: 'share_link',
  studentName: 'Zara', shareCodeId: SC, studentId: KID,
});
const settingsReads = () => fake.calls.filter((c) => c.table === 'app_settings').length;

beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.sendMessage.mockResolvedValue(true);
  require('../../shared/services/quiz/key-hold-flag').reset();
});

describe('startSession on the wa.me path, quiz_key_hold_on_disagree', () => {
  test('switch on: the held item is not asked; the other three are asked in the order they were', async () => {
    seed({ hold: true });
    const state = await start();
    expect(state.questionIds).toEqual([qid(2), qid(1), qid(4)]);
    expect(state.questionIds).not.toContain(qid(3));
    expect(logEvent).toHaveBeenCalledWith('video_quiz.session_started', expect.objectContaining({ quizId: QUIZ, questions: 3 }));
  });

  test('the unheld set is byte-identical to the switch-off session with the held item taken out', async () => {
    seed({ hold: null });
    const off = await start();
    expect(off.questionIds).toEqual([qid(2), qid(1), qid(3), qid(4)]);
    require('../../shared/services/quiz/key-hold-flag').reset();
    seed({ hold: true });
    const on = await start();
    expect(JSON.stringify(on.questionIds)).toBe(JSON.stringify(off.questionIds.filter((id) => id !== qid(3))));
  });

  test.each([['no row', null], ['false', false], ['the string "true"', 'true']])('switch off (%s): every item is asked, the held one too', async (_label, value) => {
    seed({ hold: value });
    const state = await start();
    expect(state.questionIds).toEqual([qid(2), qid(1), qid(3), qid(4)]);
  });

  test('switch on, no held row: the session is what it was, and the switch is not even read', async () => {
    seed({ hold: true, questions: bank({ held: false }) });
    const state = await start();
    expect(state.questionIds).toEqual([qid(2), qid(1), qid(3), qid(4)]);
    expect(settingsReads()).toBe(0);
  });

  test('switch on: a hold a reviewer released is asked again', async () => {
    seed({ hold: true, questions: bank({ released: true }) });
    const state = await start();
    expect(state.questionIds).toEqual([qid(2), qid(1), qid(3), qid(4)]);
  });

  test('switch on, every item held: the child is told there are no questions, and no empty session opens', async () => {
    seed({ hold: true, questions: bank().map((r) => ({ ...r, media: { key_held: HOLD } })) });
    const state = await start();
    expect(state).toBeNull();
    expect(db.quiz_sessions).toHaveLength(0);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });
});
