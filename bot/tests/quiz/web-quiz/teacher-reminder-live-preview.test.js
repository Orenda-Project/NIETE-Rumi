'use strict';
/**
 * The teacher's reminder link previews as the live class picture: app_settings `quiz_reminder_live_preview`.
 *
 * On, the reminder's quiz link /q/<CODE> carries ?v=<played> (how many children played: a count, never a name), and the
 * page's preview (dashboard ogImageFor) answers that link with the live class picture (class.jpg: played, average, top).
 * Only for a quiz (never a storybook send), only once a child has played, only when the switch reads JSON true.
 * Off (the key absent, false, or any non-true value): the reminder is byte-for-byte today's (goldens below were
 * recorded by running reminderText and quizReport on the code before this switch).
 *
 * Supabase is the faked boundary (an in-memory client that applies the filters).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The dashboard's own dependencies are not installed beside it here: its express is the bot's.
jest.mock('express', () => jest.requireActual('express'), { virtual: true });

const crypto = require('crypto');
const { makeFake } = require('./fake-supabase');

const KEY = 'quiz_reminder_live_preview';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000005a';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const LINK = 'https://portal.example.test/q/AB12CD';
const NAMES = ['Amna', 'Bilal', 'Chand', 'Dua', 'Esha', 'Fahad', 'Gul', 'Huma', 'Iqra', 'Jawad', 'Kiran', 'Laiba', 'Moin',
  'Nida', 'Omer', 'Pari', 'Qasim', 'Rida', 'Saad', 'Tooba'];

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** A class of 20 children on one list, `played` of them finished; the hand-out's message carries `link`. */
function seed({ played = 12, setting, source = 'transcript', link = LINK, message } = {}) {
  const students = NAMES.map((n, i) => ({
    id: kid(i + 1), list_id: LIST, roll_number: i + 1, student_name: `${n} Testwala`, student_name_urdu: null, is_active: true,
  }));
  const sessions = NAMES.slice(0, played).map((n, i) => ({
    id: `s${i + 1}`, quiz_id: QUIZ, share_code_id: SC, student_id: kid(i + 1), student_name: `${n} Testwala`, user_id: null,
    status: 'completed', correct_answers: (i % 4) + 1, total_questions_answered: 4, mastery_percentage: ((i % 4) + 1) * 25,
    completed_at: ago(20 - i * 0.5), created_at: ago(20.1 - i * 0.5), invited_by_student_id: null, device_ref: `dev-${i + 1}`,
  }));
  const fake = makeFake({
    quizzes: [{
      id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '5', language: 'en', quiz_source: source,
      status: 'report_sent', list_id: null, created_at: ago(30),
      meta: { share_code_id: SC, student_message: message !== undefined ? message : `Our quiz is ready! Tap: ${link}` },
    }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, created_at: ago(30) }],
    student_lists: [{ id: LIST, class_name: '5', section: 'A', user_id: TEACHER, is_active: true }],
    students,
    quiz_sessions: sessions,
    quiz_questions: [1, 2, 3, 4].map((n) => ({ id: `c000000${n}`, quiz_id: QUIZ, external_id: null, sort_order: n,
      question_text: `Question ${n}?`, option_a: 'A', option_b: 'B', option_c: 'C', option_d: 'D', correct_option: 'A' })),
    quiz_answers: [],
    app_settings: setting === undefined ? [] : [{ key: KEY, value: setting }],
  });
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  return fake;
}

const linkIn = (text) => (String(text).match(/https?:\/\/\S+/) || [null])[0];

let Data;
beforeEach(() => {
  jest.resetModules();
  Data = require('../../../shared/services/quiz/teacher-report.data');
});

describe('switch on: the quiz reminder link carries ?v=<played>', () => {
  test('12 played, a quiz, switch on: the link is /q/AB12CD?v=12 and the rest of the message is today\'s', async () => {
    seed({ played: 12, setting: true });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.summary.played).toBe(12);
    expect(linkIn(r.reminder.text)).toBe(`${LINK}?v=12`);
    expect(r.reminder.text).toBe(Data.reminderText({ topic: 'Plants', link: `${LINK}?v=12`, language: 'en', played: 12, of: 20, className: '5-A' }));
    // the report's own link (the page's "copy link") is unchanged; only the reminder carries the count
    expect(r.quiz.link).toBe(LINK);
    // counts only: no child is named in the reminder
    NAMES.forEach((n) => expect(r.reminder.text).not.toContain(n));
  });

  test('a link that already has a query string gets &v=', async () => {
    seed({ played: 3, setting: true, link: `${LINK}?lang=ur` });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(linkIn(r.reminder.text)).toBe(`${LINK}?lang=ur&v=3`);
  });

  test('a link that already names a v, a fragment, or is not a /q/<CODE> page is left as it is', async () => {
    for (const link of [`${LINK}?v=7`, `${LINK}#top`, 'https://wa.me/923000000000?text=QUIZ-AB12CD', 'https://portal.example.test/r/AB12CD']) {
      jest.resetModules();
      Data = require('../../../shared/services/quiz/teacher-report.data');
      seed({ played: 4, setting: true, link });
      const r = await Data.quizReport(TEACHER, QUIZ);
      expect(linkIn(r.reminder.text)).toBe(link);
    }
  });

  test('the produced link hits the page preview\'s live class picture (dashboard ogImageFor via renderQuizPage)', async () => {
    seed({ played: 12, setting: true });
    const r = await Data.quizReport(TEACHER, QUIZ);
    const url = new URL(linkIn(r.reminder.text));
    const code = url.pathname.split('/')[2];
    const { renderQuizPage } = require('../../../../dashboard/routes/web-quiz.routes');
    const payload = {
      quiz: { id: 'q', code, topic: 'Plants', lang: 'en', dir: 'ltr', n: 4, questions: [] },
      cls: { label: '5-A', chips: [] }, live: {}, video: null, preview: false, brand: 'niete',
      art: { class: `l.${code}.mnopqrstuvwx`, invite: null, schools: null },
    };
    const html = renderQuizPage({ payload, code, view: 'quiz', origin: 'https://portal.example.test', assetV: 't', url: url.href,
      a: url.searchParams.get('a') || undefined, v: url.searchParams.get('v') || undefined, k: undefined });
    const og = ((html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
    expect(og).toBe(`https://portal.example.test/q/${code}/art/class.jpg?a=${encodeURIComponent(`l.${code}.mnopqrstuvwx`)}&v=12`);
  });
});

describe('never the v', () => {
  test('a storybook send, switch on: no v', async () => {
    // A story send whose message is not stored keeps the quiz reminder over the web link (the web quiz on): the path
    // where a v could slip into a story's reminder.
    jest.doMock('../../../shared/services/quiz/web-quiz-link', () => ({
      webQuizOn: async () => true, webBaseUrl: () => 'https://portal.example.test',
    }));
    seed({ played: 12, setting: true, source: 'story', message: null });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.story).toBeDefined();
    expect(r.reminder).not.toBeNull();
    expect(linkIn(r.reminder.text)).toBe(LINK);
  });

  test('0 played, switch on: no v (and the plain reminder, as today)', async () => {
    seed({ played: 0, setting: true });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(linkIn(r.reminder.text)).toBe(LINK);
  });

  test.each([
    ['the string "true"', 'true'], ['the JSON string "\\"true\\""', '"true"'], ['{ enabled: true }', { enabled: true }],
    ['1', 1], ['"TRUE"', 'TRUE'], ['false', false], ['null', null],
  ])('switch %s is not a real true: no v', async (_, value) => {
    seed({ played: 12, setting: value });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(linkIn(r.reminder.text)).toBe(LINK);
  });

  test('the switch is read once per 30 s (cached), like the other report switches', async () => {
    const fake = seed({ played: 12, setting: true });
    await Data.quizReport(TEACHER, QUIZ);
    fake.db.app_settings = [];
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(linkIn(r.reminder.text)).toBe(`${LINK}?v=12`);
  });
});

describe('switch off (key absent): byte-identical to today', () => {
  // sha256 of each text, recorded on the code before this switch.
  const FIXTURES = [
    [{ topic: 'Plants', link: LINK, language: 'en' }, '64ee83fd93cd689b1995c6abfdb93c075ca27ba6d2e2dbd3672e82f5056c438b'],
    [{ topic: 'کسر', link: LINK, language: 'ur' }, 'acaeda91f6e161af7e3de579982adeb6bb1080e176cf8238ddfd59c9d62abdd3'],
    [{ topic: '', link: LINK, language: 'en' }, '3bcbc2ce03f144aa63ca6a8900306a115549a2d844216035f53ad4d1bfe492f4'],
    [{ topic: 'Plants', link: LINK, language: 'en', played: 12, of: 20, className: '5-A' }, 'aae999bb126391c81611b4359c6a38a1b136dc7858007b6c70b06c60e3b24753'],
    [{ topic: 'کسر', link: LINK, language: 'ur', played: 12, of: 31, className: '5-A' }, 'b49673d6f23e1d7fcfc8138102934d2c57f5f7f7718c481fc1acf5ece295369b'],
    [{ topic: 'Plants', link: LINK, language: 'en', played: 0, of: 6, className: '4-A' }, '64ee83fd93cd689b1995c6abfdb93c075ca27ba6d2e2dbd3672e82f5056c438b'],
    [{ topic: 'Plants', link: 'https://wa.me/923000000000?text=QUIZ-AB12CD', language: 'en' }, 'bd93f2e8828113bf89cef0a8d9859e05a3a85606f48008e29779c385fb1b2524'],
  ];
  test.each(FIXTURES.map((f, i) => [i + 1, ...f]))('reminderText fixture %i', (_, args, gold) => {
    expect(sha(Data.reminderText(args))).toBe(gold);
  });

  test('quizReport\'s reminder, key absent: today\'s text', async () => {
    seed({ played: 12 });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.reminder.text).toBe('📣 12 of 20 in 5-A have played *Plants* — your turn! Tap the link and play today: https://portal.example.test/q/AB12CD');
  });
});
