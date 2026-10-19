'use strict';
/**
 * A video lesson's quiz on the quiz page carries the lesson's Urdu-script name (student_videos.title_ur) as
 * quiz.topic_ur beside quiz.topic (app_settings web_quiz_videos_ur_titles, default off), so an Urdu page names it in
 * Urdu letters (wq.js) and its link preview says it (web-quiz-og.js facts). Off, or a lesson with no Urdu name, or a
 * quiz with no video: the answer is today's. Supabase and Redis are the boundaries and are faked. Invented children only.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  isCurrent: () => true, requestQuizAudio: jest.fn().mockResolvedValue(null), quizLanguage: () => 'en',
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const LibFlag = require('../../../shared/services/quiz/web-quiz-library-flag');
const Og = require('../../../shared/services/quiz/web-quiz-og');

const TEACHER = '11111111-1111-4111-8111-111111111181';
const QV = '22222222-2222-4222-8222-222222222281'; // a lesson with an Urdu name
const QN = '22222222-2222-4222-8222-222222222282'; // a lesson without one
const QT = '22222222-2222-4222-8222-222222222283'; // no video
const VID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaa81';
const VID2 = 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaa82';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const UR_NAME = 'جنگلی اور پالتو جانور';

function seed(on) {
  const sc = (id, code, quiz, lang) => ({ id, code, quiz_id: quiz, video_id: null, teacher_user_id: TEACHER, language: lang, active: true,
    expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(48), teacher_name: 'Ms Testwala' });
  const q = (id, topic, lang, vid) => ({ id, topic, grade: '3', subject: 'science', language: lang, quiz_source: vid ? 'video' : 'transcript', video_id: vid, meta: {} });
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_teachers', value: '"all"' }, ...(on ? [{ key: 'web_quiz_videos_ur_titles', value: true }] : [])],
    quizzes: [q(QV, 'Jangli Aur Paltu Janwar', 'ur', VID), q(QN, 'Pani Ka Chakkar', 'ur', VID2), q(QT, 'Fractions', 'en', null)],
    quiz_share_codes: [sc('sc-v', 'VID001', QV, 'ur'), sc('sc-n', 'VID002', QN, 'ur'), sc('sc-t', 'TRN001', QT, 'en')],
    quiz_questions: [QV, QN, QT].map((quiz, n) => ({ id: `cccccc0${n}-cccc-4ccc-8ccc-cccccccccc81`, quiz_id: quiz, external_id: 'q1', sort_order: 1, question_text: 'Q1',
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [], quiz_answers: [], students: [],
    student_videos: [
      { id: VID, grade: '3', subject: 'Science', clean_title: 'Jangli Aur Paltu Janwar', title_ur: UR_NAME, chapter_ur: 'جانور', migration_status: 'done', superseded_by: null },
      { id: VID2, grade: '3', subject: 'Science', clean_title: 'Pani Ka Chakkar', title_ur: null, migration_status: 'done', superseded_by: null },
    ],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'topic-ur-test-secret' };
  jest.clearAllMocks();
  redis._store.clear();
  LibFlag._reset();
});
afterAll(() => { process.env = SAVED; });

describe('the quiz page: quiz.topic_ur', () => {
  test('off: no topic_ur, the answer is today\'s byte for byte (the Urdu names are never read)', async () => {
    seed(false);
    const a = await WQ.getQuiz('VID001');
    expect(a.quiz.topic).toBe('Jangli Aur Paltu Janwar');
    expect(JSON.stringify(a)).not.toContain('topic_ur');
    expect(Object.keys(a.quiz).slice(0, 4)).toEqual(['id', 'code', 'topic', 'lang']);
  });

  test('on: a lesson with an Urdu name carries it beside topic (topic itself unchanged)', async () => {
    seed(true);
    const a = await WQ.getQuiz('VID001');
    expect(a.quiz.topic).toBe('Jangli Aur Paltu Janwar');
    expect(a.quiz.topic_ur).toBe(UR_NAME);
  });

  test('on: a lesson with no Urdu name, and a quiz with no video: no topic_ur (today\'s)', async () => {
    seed(true);
    expect(await WQ.getQuiz('VID002')).toMatchObject({ quiz: { topic: 'Pani Ka Chakkar' } });
    expect((await WQ.getQuiz('VID002')).quiz).not.toHaveProperty('topic_ur');
    expect((await WQ.getQuiz('TRN001')).quiz).not.toHaveProperty('topic_ur');
  });
});

describe('the link preview facts (web-quiz-og.js)', () => {
  test('topic_ur rides the facts only when the quiz has one', () => {
    const p = { quiz: { lang: 'ur', topic: 'Jangli Aur Paltu Janwar', n: 1 }, cls: {} };
    expect(Og.facts(p).quiz).toEqual({ lang: 'ur', topic: 'Jangli Aur Paltu Janwar', n: 1 });
    expect(Og.facts({ ...p, quiz: { ...p.quiz, topic_ur: UR_NAME } }).quiz).toEqual({ lang: 'ur', topic: 'Jangli Aur Paltu Janwar', n: 1, topic_ur: UR_NAME });
  });
});

describe('the home\'s ranked Next: a quiz row\'s Urdu sub-line (web-quiz-next-offer-sources.js)', () => {
  const Src = require('../../../shared/services/quiz/web-quiz-next-offer-sources');
  const out = (ur) => ({
    kid: 'c1',
    teacher: { code: 'VID001', k: 'k1', topic: 'Jangli Aur Paltu Janwar', subject: 'science', ...(ur ? { topic_ur: UR_NAME } : {}) },
    last: { code: 'VID002', k: 'k2', topic: 'Pani Ka Chakkar', subject: 'science', state: 'open', ...(ur ? { topic_ur: 'پانی کا چکر' } : {}) },
    again: [{ code: 'TRN001', k: 'k3', topic: 'Fractions', subject: 'maths', ...(ur ? { topic_ur: 'کسر' } : {}) }],
  });
  const subs = (o) => Src.candidatesOf({ out: o, token: 'tok' }).filter((c) => c.kind === 'quiz').map((c) => [c.sub, c.sub_ur]);
  test('a row with topic_ur: sub_ur is the Urdu name; without: today\'s (sub_ur = sub)', () => {
    expect(subs(out(true))).toEqual([['Jangli Aur Paltu Janwar', UR_NAME], ['Pani Ka Chakkar', 'پانی کا چکر'], ['Fractions', 'کسر']]);
    expect(subs(out(false))).toEqual([['Jangli Aur Paltu Janwar', 'Jangli Aur Paltu Janwar'], ['Pani Ka Chakkar', 'Pani Ka Chakkar'], ['Fractions', 'Fractions']]);
  });
});
