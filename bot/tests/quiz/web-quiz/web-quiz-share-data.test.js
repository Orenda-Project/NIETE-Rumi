'use strict';
/**
 * The card's result (app_settings web_quiz_share_data, on top of the one share; default OFF): the finish's score,
 * stars, words read and badge, read from the server's own rows at mint and sealed into the token; the landing gets them
 * with their lines in the card's language and a dare. Never a number the page sends, never a reading speed. Off: the
 * mint answer, the token and the landing are the one share's, as today.
 * Over HTTP through the real internal router; mocked only at the boundaries (Supabase, the read length, loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-video-thumb', () => ({ thumb: jest.fn(async () => null), VERSION: '1' }));
jest.mock('../../../shared/services/quiz/web-quiz-challenge', () => ({ readLength: jest.fn() }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { bank } = require('../../../shared/services/quiz/web-quiz-bank');
const { readLength } = require('../../../shared/services/quiz/web-quiz-challenge');
const T = require('../../../shared/services/quiz/web-quiz-token');

const BOOK = '3b9c1e2a-7d4f-4a1b-9c2d-5e6f7a8b9c0d';
const VID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
const KEY = { 'x-api-key': 'share-key', 'content-type': 'application/json' };
const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

let rows;
function seed({ data = true, dataValue, session = {}, runs = [], events = [], quizzes = [], sessions = [], code = {} } = {}) {
  rows = {
    app_settings: [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value: true }, ...(data ? [{ key: 'web_quiz_share_data', value: dataValue === undefined ? true : dataValue }] : [])],
    quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', topic: 'Plants', language: 'en', active: true, ...code }],
    students: [{ id: 'st-1', student_name: 'Amal Testwala' }, { id: 'st-2', student_name: 'Noor Testwala' }],
    quiz_sessions: [{ id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 8, total_questions_answered: 10, ...session }, ...sessions],
    web_quiz_challenge_runs: runs,
    story_events: events,
    quizzes,
    story_books: [{ id: BOOK, status: 'ready', title: 'The lost kite' }],
  };
  const fake = makeFake(rows);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Card._reset();
}

let server; let base; let Card; let Data;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'share-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  process.env.WHATSAPP_BOT_NUMBER = '15550001111';
  Card = require('../../../shared/services/quiz/web-quiz-card-image');
  Data = require('../../../shared/services/quiz/web-quiz-card-data');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  seed();
  bank.mockResolvedValue({ rows: [{ id: VID, r2_url: 'x', clean_title: 'Parts of a plant' }] });
  readLength.mockResolvedValue(50);
});

const ct = (ex = 'read', runId = 'run-1') => T.signChallenge({ studentId: 'st-2', ex, runId });
const st = () => T.signSession({ sessionId: SID, deviceRef: 'dddddddddddddddddddddd', shareCodeId: 'sc-1' });
async function mint(body) {
  const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ lang: 'en', ...body }) });
  return { status: r.status, body: await r.json() };
}
async function landing(token) { return (await fetch(`${base}/card/${token}`, { headers: KEY })).json(); }
const run = (extra) => ({ id: 'run-1', student_id: 'st-2', exercise: 'read', status: 'scored', meta: {}, ...extra });
const QUIZ = { kind: 'quiz', deed: 'quiz_done' };

describe('the switch', () => {
  test.each([['absent', { data: false }], ['false', { dataValue: false }], ['the string "true"', { dataValue: 'true' }], ['1', { dataValue: 1 }]])('%s: the mint answer, the token and the landing carry no result', async (_, o) => {
    seed(o);
    const { body } = await mint({ ...QUIZ, st: st() });
    expect(body.v4).toBe(true);
    expect(body).not.toHaveProperty('data');
    expect(Card.facts(body.token)).not.toHaveProperty('data');
    const l = await landing(body.token);
    expect(l).not.toHaveProperty('result');
    expect(l).not.toHaveProperty('result_text');
  });
  test('off: the session read asks for today\'s columns only', async () => {
    seed({ data: false });
    const spy = jest.spyOn(supabase, 'from');
    await mint({ ...QUIZ, st: st() });
    expect(spy.mock.calls.filter(([t]) => t === 'web_quiz_challenge_runs' || t === 'story_events' || t === 'quizzes')).toHaveLength(0);
    spy.mockRestore();
  });
});

describe('a class quiz: its session row', () => {
  test('8 of 10: the score, 2 stars, no badge; the landing\'s lines and the dare to beat it (en and ur)', async () => {
    const { body } = await mint({ ...QUIZ, st: st() });
    expect(body.data).toEqual({ r: 8, o: 10, s: 2 });
    const l = await landing(body.token);
    expect(l.result).toEqual({ r: 8, o: 10, s: 2 });
    expect(l.result_text).toEqual({ stars: 2, stars_text: '2 stars', score: '8 out of 10 right', dare: 'Can you get 10 out of 10?' });
    const ur = await mint({ ...QUIZ, st: st(), lang: 'ur' });
    expect((await landing(ur.body.token)).result_text).toEqual({ stars: 2, stars_text: '۲ ستارے', score: '۱۰ میں سے ۸ صحیح', dare: 'آپ ۱۰ کے ۱۰ صحیح کر کے دکھائیں!' });
  });
  test('all right: 3 stars and the quiz badge; a video\'s quiz: the video badge', async () => {
    seed({ session: { correct_answers: 5, total_questions_answered: 5 } });
    expect((await mint({ ...QUIZ, st: st() })).body.data).toEqual({ r: 5, o: 5, s: 3, b: 'quiz_champ' });
    seed({ session: { correct_answers: 5, total_questions_answered: 5 }, code: { video_id: VID } });
    const { body } = await mint({ ...QUIZ, st: st(), lang: 'ur' });
    expect(body.data.b).toBe('video_star');
    expect((await landing(body.token)).result_text.badge).toBe('ویڈیو کا ستارہ');
  });
  test('one question: the dare in its own words (no «۱ کے ۱»)', async () => {
    seed({ session: { correct_answers: 1, total_questions_answered: 1 } });
    expect((await landing((await mint({ ...QUIZ, st: st() })).body.token)).result_text.dare).toBe('Can you get it right too?');
    expect((await landing((await mint({ ...QUIZ, st: st(), lang: 'ur' })).body.token)).result_text.dare).toBe('آپ بھی صحیح جواب دے کر دکھائیں!');
  });
  test('numbers the page sends are never the card\'s', async () => {
    const { body } = await mint({ ...QUIZ, st: st(), data: { r: 99, o: 99, s: 3, b: 'quiz_champ' }, score: 99, stars: 3, words: 500 });
    expect(body.data).toEqual({ r: 8, o: 10, s: 2 });
  });
});

describe('a Jugnu read: its run row, never its speed', () => {
  test('the whole story read, 48 of 50 right: 3 stars, the star badge, the story\'s words', async () => {
    seed({ runs: [run({ score: { attempted: 50, correct: 48, stopped: false, finished_early: true, time_left: 12 } })] });
    const { body } = await mint({ kind: 'read', deed: 'read_all', ct: ct() });
    expect(body.data).toEqual({ s: 3, b: 'star_reader', w: 50 });
    const l = await landing(body.token);
    expect(l.result_text).toEqual({ stars: 3, stars_text: '3 stars', words: '50 words read', badge: 'Star reader', dare: 'Can you read 50 words too?' });
    expect(JSON.stringify(l)).not.toMatch(/wcpm|time_left|finished_early|correct/);
  });
  test('part of the story (a timer-ended minute): stars and badge, but no number of words', async () => {
    seed({ runs: [run({ score: { attempted: 30, correct: 24, stopped: true, time_left: 0 } })] });
    const { body } = await mint({ kind: 'read', deed: 'read_some', ct: ct() });
    expect(body.data).toEqual({ s: 2, b: 'brave_reader' });
    expect((await landing(body.token)).result_text).toEqual({ stars: 2, stars_text: '2 stars', badge: 'Brave reader', dare: 'Can you read it too?' });
  });
  test('nothing heard, or an implausible read: no stars, the brave-try badge', async () => {
    seed({ runs: [run({ score: { attempted: 40, correct: 40 }, meta: { quality: 'implausible' } })] });
    const { body } = await mint({ kind: 'read', deed: 'read_tried', ct: ct() });
    expect(body.data).toEqual({ s: 0, b: 'brave_try' });
    const ur = await mint({ kind: 'read', deed: 'read_tried', ct: ct(), lang: 'ur' });
    expect((await landing(ur.body.token)).result_text).toMatchObject({ stars: 0, stars_text: 'کوئی ستارہ نہیں', badge: 'ہمت والی کوشش' });
  });
  test('Story Time\'s questions: the score beside the read', async () => {
    seed({ runs: [run({ score: { attempted: 50, correct: 50 }, meta: { comp: { asked: 3, correct: 2 } } })] });
    expect((await mint({ kind: 'story', deed: 'story_read', ct: ct() })).body.data).toEqual({ r: 2, o: 3, s: 3, b: 'star_reader', w: 50 });
  });
  test('another child\'s run, or a run not scored yet: no result', async () => {
    seed({ runs: [run({ student_id: 'st-1', score: { attempted: 50, correct: 50 } })] });
    expect((await mint({ kind: 'read', deed: 'read_all', ct: ct() })).body).not.toHaveProperty('data');
    seed({ runs: [run({ status: 'pending', score: { attempted: 50, correct: 50 } })] });
    expect((await mint({ kind: 'read', deed: 'read_all', ct: ct() })).body).not.toHaveProperty('data');
  });
});

describe('a game, a listen', () => {
  test('a game 9 of 10: 3 stars and the game badge; a listen 2 of 4: 1 star', async () => {
    seed({ runs: [run({ exercise: 'bigger', score: { correct: 9, n: 10, stopped: false } }), run({ id: 'run-2', exercise: 'listen', score: { correct: 2, n: 4 } })] });
    expect((await mint({ kind: 'game', deed: 'game_done', ct: ct('bigger') })).body.data).toEqual({ r: 9, o: 10, s: 3, b: 'game_champ' });
    const l = await mint({ kind: 'listen', deed: 'listen_done', ct: ct('listen', 'run-2'), lang: 'ur' });
    expect(l.body.data).toEqual({ r: 2, o: 4, s: 1 });
    expect((await landing(l.body.token)).result_text).toEqual({ stars: 1, stars_text: '۱ ستارہ', score: '۴ میں سے ۲ صحیح', dare: 'آپ ۴ کے ۴ صحیح کر کے دکھائیں!' });
  });
});

describe('a storybook: the child\'s events for it, since it was last opened, in the last 30 minutes', () => {
  const ev = (event, page, data, min) => ({ child_id: 'st-2', book_id: BOOK, page_n: page, event, data, at: ago(min) });
  test('questions, the stars of their score (never the effort stars beside it) and each page\'s best words (at most its words)', async () => {
    seed({ events: [
      ev('story_opened', null, {}, 50), ev('story_page_read', 1, { words_read: 40, words_total: 40 }, 49),
      ev('story_opened', null, {}, 12),
      ev('story_page_read', 1, { words_read: 30, words_total: 40 }, 11), ev('story_page_read', 1, { words_read: 35, words_total: 40 }, 10),
      ev('story_page_read', 2, { words_read: 99, words_total: 25 }, 9),
      ev('story_questions_done', null, { correct: 3, total: 4, stars: 3 }, 8), ev('story_done', null, { pages_listened: 0, pages_read: 2, stars: 3 }, 7),
    ] });
    const { body } = await mint({ kind: 'book', deed: 'book_read', ct: ct(), item: { type: 'book', id: BOOK } });
    expect(body.data).toEqual({ r: 3, o: 4, s: 2, w: 60 });
    expect((await landing(body.token)).result_text.dare).toBe('Can you get 4 out of 4?');
  });
  test('the stars a friend sees agree with the score: 4 of 5 is 2 stars, 5 of 5 is 3 and the badge, whatever the effort stars', async () => {
    seed({ events: [ev('story_opened', null, {}, 9), ev('story_questions_done', null, { correct: 4, total: 5, stars: 1 }, 8), ev('story_done', null, { pages_read: 1, stars: 1 }, 7)] });
    expect((await mint({ kind: 'book', deed: 'book_read', ct: ct(), item: { type: 'book', id: BOOK } })).body.data).toEqual({ r: 4, o: 5, s: 2 });
    seed({ events: [ev('story_opened', null, {}, 9), ev('story_questions_done', null, { correct: 5, total: 5, stars: 1 }, 8)] });
    expect((await mint({ kind: 'book', deed: 'book_read', ct: ct(), item: { type: 'book', id: BOOK } })).body.data).toEqual({ r: 5, o: 5, s: 3, b: 'star_reader' });
  });
  test('only listened, nothing older than 30 minutes counted: the stars, the story dare', async () => {
    seed({ events: [ev('story_page_read', 1, { words_read: 40, words_total: 40 }, 45), ev('story_done', null, { pages_listened: 3, pages_read: 0, stars: 1 }, 5)] });
    const { body } = await mint({ kind: 'book', deed: 'listen_done', ct: ct(), item: { type: 'book', id: BOOK } });
    expect(body.data).toEqual({ s: 1 });
    expect((await landing(body.token)).result_text.dare).toBe('Can you read it too?');
  });
});

describe('one star band for every card with a score, by percent', () => {
  test('3/4, 4/5 and 8/10 are 2 stars, 2/4 is 1, 5/5 and 9/10 are 3: a higher score never gets fewer stars', () => {
    const { starsOf } = require('../../../shared/services/quiz/web-quiz-card-data');
    expect([[3, 4], [4, 5], [8, 10], [2, 4], [5, 5], [9, 10], [1, 4]].map(([r, o]) => starsOf(r, o))).toEqual([2, 2, 2, 1, 3, 3, 1]);
    const scores = [[1, 4], [2, 4], [3, 4], [4, 5], [8, 10], [9, 10], [5, 5]];
    const stars = scores.map(([r, o]) => starsOf(r, o));
    expect(stars).toEqual([...stars].sort((x, y) => x - y));
  });
});

describe('a video: the child\'s newest quiz on it', () => {
  test('5 of 5 within 30 minutes: the score and the video badge; none: watched only, no result', async () => {
    seed({ quizzes: [{ id: 'qv-1', video_id: VID }], sessions: [{ id: 's-v', quiz_id: 'qv-1', student_id: 'st-2', status: 'completed', correct_answers: 5, total_questions_answered: 5, completed_at: ago(3) }] });
    expect((await mint({ kind: 'video', deed: 'video_watched', ct: ct(), item: { type: 'video', id: VID } })).body.data).toEqual({ r: 5, o: 5, s: 3, b: 'video_star' });
    seed({ quizzes: [{ id: 'qv-1', video_id: VID }], sessions: [{ id: 's-v', quiz_id: 'qv-1', student_id: 'st-2', status: 'completed', correct_answers: 5, total_questions_answered: 5, completed_at: ago(90) }] });
    expect((await mint({ kind: 'video', deed: 'video_watched', ct: ct(), item: { type: 'video', id: VID } })).body).not.toHaveProperty('data');
  });
});

describe('what the token keeps', () => {
  test('only known fields, whole numbers, a known badge, the score at most its total', () => {
    expect(Data.clean({ r: 12, o: 10, s: 7, w: -3, b: 'faster', wcpm: 80 })).toEqual({ r: 10, o: 10, s: 3 });
    expect(Data.clean({ wcpm: 80 })).toBeNull();
  });
});
