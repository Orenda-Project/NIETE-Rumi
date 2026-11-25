'use strict';
/**
 * The teacher's live quiz report: "what your class got wrong, and the likely confusion" (queue #299, bd-vo9fkc).
 *
 * app_settings `quiz_report_misconceptions` (off unless JSON true). On, the report carries `misconceptions`: each
 * question where one wrong answer drew most of the class's wrong answers, with that option's authored feedback as the
 * likely confusion — ONLY for a question whose answer key a person confirmed right (quiz_item_reviews key_ok or fixed,
 * and no row still holding it: open / key_wrong / ambiguous). Off, a missing table or a failed read: the report is
 * today's, byte for byte (no key added). Nothing is sent on WhatsApp: the page only.
 *
 * Drives the real quizReport() and the real page template. Faked at the boundary only: Supabase (in-memory).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const Q = (n) => `c0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const NAMES = ['Amna', 'Bilal', 'Chand', 'Dua', 'Esha'];

// Q1: 4 of 5 wrong, 3 on C — a cluster. Q2: 2 wrong, one B one C — a tie, no cluster. Q3: 3 wrong, all D — a cluster.
// Q4: 1 wrong — one child's slip, never a class pattern.
const PICKS = { 1: ['A', 'C', 'C', 'C', 'B'], 2: ['A', 'A', 'A', 'B', 'C'], 3: ['B', 'D', 'D', 'D', 'B'], 4: ['A', 'A', 'A', 'A', 'B'] };
const KEYS = { 1: 'A', 2: 'A', 3: 'B', 4: 'A' };
const FEEDBACK = {
  1: { wrong: { 1: 'Not quite! B is a leaf.', 2: 'Good try! They think the stem drinks water because it is long. Keep going!' } },
  3: { wrong: { 3: 'They counted the corners twice.' } },
};

function seed({ setting = true, reviews = [], reviewsBroken = false, feedback = FEEDBACK } = {}) {
  const sessions = NAMES.map((name, i) => ({
    id: `s${i + 1}`, quiz_id: QUIZ, share_code_id: SC, student_id: kid(i + 1), student_name: `${name} Testwala`, user_id: null,
    status: 'completed', correct_answers: 2, total_questions_answered: 4, completed_at: ago(10 - i), created_at: ago(11 - i),
    invited_by_student_id: null, device_ref: `dev-${i}`,
  }));
  const answers = [];
  Object.entries(PICKS).forEach(([n, picks]) => picks.forEach((p, i) => answers.push({
    session_id: `s${i + 1}`, question_id: Q(Number(n)), selected_option: p, is_correct: p === KEYS[n],
  })));
  const db = {
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
      status: 'sent', list_id: null, created_at: ago(30), meta: { share_code_id: SC } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, invited_by_student_id: null, created_at: ago(30) }],
    student_lists: [], students: [],
    quiz_sessions: sessions,
    quiz_questions: [1, 2, 3, 4].map((n) => ({ id: Q(n), quiz_id: QUIZ, external_id: null, sort_order: n, question_text: `Question ${n}?`,
      option_a: `apple ${n}`, option_b: `banana ${n}`, option_c: `cherry ${n}`, option_d: `date ${n}`, correct_option: KEYS[n],
      option_feedback: feedback[n] || null })),
    quiz_answers: answers,
    app_settings: setting === null ? [] : [{ key: 'quiz_report_misconceptions', value: setting }],
  };
  if (!reviewsBroken) db.quiz_item_reviews = reviews.map(([n, status], i) => ({ id: `r${i}`, question_id: Q(n), status, reason: 'blind_solve' }));
  const fake = makeFake(db);
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  return fake;
}

let Data;
beforeEach(() => {
  jest.resetModules();
  Data = require('../../../shared/services/quiz/teacher-report.data');
});

describe('quizReport misconceptions', () => {
  test('switch off (no row, or not true): no misconceptions key and questions exactly as today', async () => {
    seed({ setting: null, reviews: [[1, 'key_ok'], [3, 'fixed']] });
    const off = await Data.quizReport(TEACHER, QUIZ);
    expect(off).not.toHaveProperty('misconceptions');
    expect(Object.keys(off.questions[0]).sort()).toEqual(['answered', 'correctPct', 'n', 'text', 'wrongTop']);
    jest.resetModules();
    Data = require('../../../shared/services/quiz/teacher-report.data');
    seed({ setting: { on: true }, reviews: [[1, 'key_ok']] });
    expect(await Data.quizReport(TEACHER, QUIZ)).not.toHaveProperty('misconceptions');
  });

  test('on: only confirmed keys, only a real cluster, with the option\'s feedback made teacher-facing', async () => {
    seed({ reviews: [[1, 'key_ok'], [2, 'key_ok'], [3, 'fixed'], [4, 'key_ok']] });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.misconceptions).toEqual([
      { n: 1, text: 'Question 1?', pick: { option: 'C', text: 'cherry 1' }, right: { option: 'A', text: 'apple 1' },
        picked: 3, answered: 5, confusion: 'They think the stem drinks water because it is long.' },
      { n: 3, text: 'Question 3?', pick: { option: 'D', text: 'date 3' }, right: { option: 'B', text: 'banana 3' },
        picked: 3, answered: 5, confusion: 'They counted the corners twice.' },
    ]);
    // the per-question list is untouched by the switch
    expect(Object.keys(r.questions[0]).sort()).toEqual(['answered', 'correctPct', 'n', 'text', 'wrongTop']);
  });

  test('on: a key never reviewed, or still held by the queue, is never shown', async () => {
    // Q1 confirmed by one row but held by another (the nightly flag reopened it); Q3 never reviewed
    seed({ reviews: [[1, 'key_ok'], [1, 'open'], [2, 'key_ok']] });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.misconceptions).toEqual([]);
  });

  test('on: a missing review table or failed read shows nothing and the report still renders', async () => {
    seed({ reviewsBroken: true });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.misconceptions).toEqual([]);
    expect(r.played).toHaveLength(5);
  });

  test('on: a cluster with no authored feedback is shown without a confusion line', async () => {
    seed({ reviews: [[3, 'key_ok']], feedback: {} });
    const r = await Data.quizReport(TEACHER, QUIZ);
    expect(r.misconceptions).toEqual([{ n: 3, text: 'Question 3?', pick: { option: 'D', text: 'date 3' },
      right: { option: 'B', text: 'banana 3' }, picked: 3, answered: 5, confusion: null }]);
  });
});

describe('the page block', () => {
  const { renderPage } = require('../../../shared/templates/teacher-report.page');
  const base = {
    quiz: { id: QUIZ, topic: 'Plants', language: 'en', source: 'transcript', code: 'AB12CD' },
    roster: { state: 'none', lists: [] }, summary: { played: 5, total: 4 }, played: [], notPlayed: null, provisional: [],
    questions: [{ n: 1, text: 'Question 1?', answered: 5, correctPct: 20, wrongTop: { option: 'C', text: 'cherry 1', pct: 75 } }],
    guidance: null, reminder: null,
  };
  const block = [{ n: 1, text: 'Question 1?', pick: { option: 'C', text: 'cherry 1' }, right: { option: 'A', text: 'apple 1' },
    picked: 3, answered: 5, confusion: 'They think the stem drinks water.' }];
  const page = (data, lang = 'en') => renderPage({ quiz: data }, { lang, tab: 'quiz', tokens: { self: 'TOK.sig' } });

  test('no misconceptions key: the page is byte for byte today\'s; an empty list prints no block either', () => {
    const today = page(base);
    expect(today).not.toContain('id="confusions"');
    expect(page({ ...base, misconceptions: [] })).toBe(today);
  });

  test('English: heading, the pick, the right answer, the count and the likely confusion, before the question list', () => {
    const html = page({ ...base, misconceptions: block });
    expect(html).toContain('id="confusions"');
    expect(html).toContain('What your class got wrong');
    expect(html).toContain('cherry 1');
    expect(html).toContain('apple 1');
    expect(html).toContain('They think the stem drinks water.');
    expect(html.indexOf('id="confusions"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="questions"')).toBeGreaterThan(html.indexOf('id="confusions"'));
  });

  test('Urdu: Urdu heading and Urdu digits for the count', () => {
    const html = page({ ...base, quiz: { ...base.quiz, language: 'ur' }, misconceptions: block }, 'ur');
    expect(html).toContain('id="confusions"');
    expect(html).toContain('آپ کی کلاس نے کہاں غلطی کی');
    expect(html).toMatch(/۳/);
    expect(html).toMatch(/۵/);
  });

  // bd-vp2567: on prod (25 Nov) two real reports printed the authored feedback's TeX as code. These are those two lines,
  // verbatim; the block must typeset them the way the question text already is (M → mathHtml / KaTeX), on both pages.
  const REAL = [
    'Remember, for arrays, we multiply the rows and columns, we don\'t add them. $5 + 4 = 9$, but $5 \\times 4 = 20$.',
    'یہ $16\\,\\text{m}^2$ نہیں ہے۔ $m^2$ Area کی unit ہے، Perimeter کی نہیں۔ Perimeter کی unit \'m\' ہوتی ہے۔',
  ];
  const section = (html) => html.slice(html.indexOf('id="confusions"'), html.indexOf('</section>', html.indexOf('id="confusions"')));
  test.each([['en'], ['ur']])('%s page: the likely confusion shows maths typeset, never raw TeX', (lang) => {
    for (const confusion of REAL) {
      const html = page({ ...base, quiz: { ...base.quiz, language: lang }, misconceptions: [{ ...block[0], confusion }] }, lang);
      const cf = section(html).slice(section(html).indexOf('cf-why'));
      expect(cf).toContain('class="katex"');
      expect(cf).not.toMatch(/\$|\\times|\\text|\\,/);
      expect(html).toContain('.katex');
    }
  });
});
