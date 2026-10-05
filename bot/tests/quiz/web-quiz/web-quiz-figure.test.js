'use strict';
/**
 * Web quiz figures: the page gets the DRAWING, never the WhatsApp question card.
 *
 * On WhatsApp a question with long options or maths is sent as a card — a PNG
 * with the stem and the options painted in. On the web the stem and options are
 * text, so the card would show the question twice. A question with a figure
 * spec is drawn by the lp-v9 engine as an inline SVG, without the chrome
 * (counter, mark, lattice), with words the voice can say before the stem.
 *
 * Supabase is the boundary and is faked; the diagram engine, the pictogram set
 * and the E2 payload run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// openchemlib (molecule figures) is an ES module jest cannot load; the repo's stub, as every figure test does.
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Fig = require('../../../shared/services/quiz/web-quiz-figure');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

const BARS = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] };

function row(n, media, extra = {}) {
  return {
    id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
    question_text: `Question ${n}`, option_a: 'one quarter', option_b: 'three quarters', option_c: 'one half', option_d: null,
    correct_option: 'B', explanation: 'Count the shaded parts.', option_feedback: null, media, render_pattern: 'P1', ...extra,
  };
}

function seed(questions, language = 'en') {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Fractions', language, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Fractions', grade: '3', subject: 'Maths', language, meta: {}, quiz_source: 'transcript' }],
    quiz_questions: questions,
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; });
afterAll(() => { process.env = SAVED; });

describe('figureFor (one question row → the page figure)', () => {
  test('a figure spec is drawn as inline SVG with no chrome, sized, with alt and a non-leaking spoken line', () => {
    const f = Fig.figureFor(row(1, { figure: BARS, language: 'en', question_image: 'https://r2/f.png' }));
    expect(f.kind).toBe('svg');
    expect(f.svg.startsWith('<svg')).toBe(true);
    expect(f.svg).not.toMatch(/Question 1|of 5|lattice/);
    expect(f.type).toBe('fraction_bar');
    expect(f.w).toBeGreaterThan(0);
    expect(f.h).toBeGreaterThan(0);
    expect(f.say).toBe('Look at the bars.');
    expect(f.alt).toMatch(/bar/i);
    expect(`${f.alt} ${f.say}`).not.toMatch(/\b3\b|three/);
    expect(f.svg).toContain(`aria-label="${f.alt}"`);
  });

  test('the drawing wears the NIETE palette the WhatsApp picture wears, set on its own root (not the engine defaults)', () => {
    const f = Fig.figureFor(row(1, { figure: BARS, language: 'en' }));
    const root = /^<svg[^>]*>/.exec(f.svg)[0];
    expect(root).toMatch(/--amber:\s*#47BA7D/i);
    expect(root).toMatch(/--navy:\s*#333748/i);
  });

  test('Urdu: the spoken line is Urdu and the direction is rtl', () => {
    const f = Fig.figureFor(row(1, { figure: BARS, language: 'ur' }));
    expect(f.say).toBe('پٹیوں کو دیکھیں۔');
    expect(f.dir).toBe('rtl');
  });

  test('no spoken pointer when the stem already points at the picture (said once, not twice)', () => {
    const en = Fig.figureFor(row(1, { figure: BARS, language: 'en' }, { question_text: 'Look at the picture. How much is shaded?' }));
    expect(en.say).toBeNull();
    expect(en.alt).toMatch(/bar/i);
    const ur = Fig.figureFor(row(1, { figure: BARS, language: 'ur' }, { question_text: 'تصویر میں کتنا حصہ رنگا ہوا ہے؟' }));
    expect(ur.say).toBeNull();
  });

  test('a text-only WhatsApp card is never a figure', () => {
    expect(Fig.figureFor(row(1, { question_card: 'https://r2/card.png', language: 'en' }))).toBeNull();
  });

  test('a spec the engine cannot draw falls back to the figure-only PNG, never the card', () => {
    const f = Fig.figureFor(row(1, { figure: { type: 'not_a_type' }, question_image: 'https://r2/f.png', question_card: 'https://r2/card.png', language: 'en' }));
    expect(f).toEqual(expect.objectContaining({ kind: 'img', src: 'question_image' }));
  });

  test('the v2 item figure wins over the legacy spec', () => {
    const f = Fig.figureFor(row(1, { figure: BARS, language: 'en', web: { figure: { spec: { type: 'clock', time: '3:00' }, say: 'Look at the clock face.' } } }));
    expect(f.type).toBe('clock');
    expect(f.say).toBe('Look at the clock face.');
  });
});

describe('safeSvg (the allowlist an inline drawing must pass)', () => {
  test('engine output passes', () => {
    expect(Fig.safeSvg('<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="var(--navy, #0B2545)"/></svg>')).toBeTruthy();
  });
  test.each([
    ['script', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
    ['event handler', '<svg viewBox="0 0 1 1" onload="alert(1)"></svg>'],
    ['external link', '<svg viewBox="0 0 1 1"><a href="https://x"><rect/></a></svg>'],
    ['image', '<svg viewBox="0 0 1 1"><image href="https://x/y.png"/></svg>'],
    ['url() paint', '<svg viewBox="0 0 1 1"><rect fill="url(https://x)"/></svg>'],
    ['iframe in foreignObject', '<svg viewBox="0 0 1 1"><foreignObject><iframe src="x"></iframe></foreignObject></svg>'],
  ])('%s is refused', (_, svg) => {
    expect(Fig.safeSvg(svg)).toBeNull();
  });
});

describe('optionPic (picture options are drawings, never emoji)', () => {
  test('a roster pictogram becomes a 72x72 SVG with its spoken name', () => {
    const p = Fig.optionPic({ kind: 'pictogram', name: 'apple' }, 'en');
    expect(p.svg).toMatch(/^<svg[^>]*viewBox="0 0 72 72"/);
    expect(p.name).toBe('apple');
    expect(Fig.safeSvg(p.svg)).toBeTruthy();
  });
  test('an unknown name, an emoji, or a raw svg from the model is no picture', () => {
    expect(Fig.optionPic({ kind: 'pictogram', name: 'no-such-thing-xyz' }, 'en')).toBeNull();
    expect(Fig.optionPic({ kind: 'emoji', name: '🍎' }, 'en')).toBeNull();
    expect(Fig.optionPic({ kind: 'svg', svg: '<svg><script/></svg>' }, 'en')).toBeNull();
  });
  test('the spoken name is in the quiz language: the option word wins over the English roster name', () => {
    const p = Fig.optionPic({ kind: 'pictogram', name: 'apple' }, 'ur', { word: 'سیب' });
    expect(p.name).toBe('سیب');
    expect(p.svg).toContain('aria-label="سیب"');
    expect(Fig.optionPic({ kind: 'pictogram', name: 'apple' }, 'ur')).toBeNull();
  });
  test('a glyph option is a big letter or mark tile, right-to-left for Urdu, escaped', () => {
    const p = Fig.optionPic({ kind: 'glyph', text: 'بّ' }, 'ur', { word: 'تشدید' });
    expect(p.svg).toMatch(/^<svg[^>]*viewBox="0 0 72 72"/);
    expect(p.svg).toContain('بّ');
    expect(p.svg).toContain('dir="rtl"');
    expect(p.name).toBe('تشدید');
    expect(Fig.safeSvg(p.svg)).toBeTruthy();
    expect(Fig.optionPic({ kind: 'glyph', text: '<b>' }, 'en', { word: 'x' }).svg).not.toContain('<b>');
    expect(Fig.optionPic({ kind: 'glyph', text: 'too long for a tile' }, 'en')).toBeNull();
  });
  test('a small engine drawing can be an option', () => {
    const p = Fig.optionPic({ kind: 'figure', spec: { type: 'clock', time: '3:00' }, name: 'three o\'clock' }, 'en');
    expect(p.svg.startsWith('<svg')).toBe(true);
    expect(p.name).toBe('three o\'clock');
  });
});

describe('drawOptionPics (the last step of an E2 question, whoever filled the options)', () => {
  test('raw stored pics (the v2 item merge shape) become drawings named in the quiz language; an undrawable one is removed', () => {
    const options = [
      { slot: 'A', text: '', name: 'سیب', pic: { kind: 'pictogram', name: 'apple' } },
      { slot: 'B', text: 'بلی', pic: { kind: 'pictogram', name: 'cat' } },
      { slot: 'C', text: 'x', name: 'y', pic: { kind: 'emoji', name: '🚌' } },
      { slot: 'D', text: 'kept', pic: { svg: '<svg viewBox="0 0 72 72"></svg>', name: 'kept' } },
    ];
    Fig.drawOptionPics(options, 'ur');
    expect(options[0].pic.name).toBe('سیب');
    expect(options[0].pic.svg).toMatch(/viewBox="0 0 72 72"/);
    expect(options[1].pic.name).toBe('بلی');
    expect(options[2].pic).toBeUndefined();
    expect(options[3].pic.name).toBe('kept');
  });
});

describe('E2 carries figures, not cards', () => {
  test('figure question: inline svg; img is the figure PNG, never the card', async () => {
    seed([row(1, { figure: BARS, question_image: 'https://r2/fig.png', question_card: 'https://r2/card.png', language: 'en' })]);
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    expect(q.figure).toEqual(expect.objectContaining({ kind: 'svg', type: 'fraction_bar' }));
    expect(q.img).toBe(`/api/wq/media/AB12CD/${qid(1)}?k=q`);
    expect(await WQ.media('AB12CD', qid(1), { k: 'q' })).toEqual({ redirect: 'https://r2/fig.png' });
  });

  test('text-only card question: no img, no figure (the text is on the page already)', async () => {
    seed([row(1, { question_card: 'https://r2/card.png', language: 'en' })]);
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    expect(q.img).toBeUndefined();
    expect(q.figure).toBeUndefined();
    await expect(WQ.media('AB12CD', qid(1), { k: 'q' })).rejects.toMatchObject({ status: 404 });
  });

  test('picture options from the v2 item arrive as drawings on their slots', async () => {
    seed([row(1, { language: 'en', web: { v: 2, type: 'picture', options: [
      { slot: 'A', text: 'apple', pic: { kind: 'pictogram', name: 'apple' } },
      { slot: 'B', text: 'cat', pic: { kind: 'pictogram', name: 'cat' } },
      { slot: 'C', text: 'bus', pic: { kind: 'pictogram', name: 'bus' } },
    ] } }, { option_a: 'apple', option_b: 'cat', option_c: 'bus' })]);
    const q = (await WQ.getQuiz('AB12CD')).quiz.questions[0];
    expect(q.options.map((o) => o.pic && o.pic.name)).toEqual(['apple', 'cat', 'bus']);
    expect(q.options[1].pic.svg).toContain('aria-label="cat"');
    expect(q.options[0].pic.svg).toMatch(/viewBox="0 0 72 72"/);
  });
});
