'use strict';
/**
 * Web quiz pictures a child can read at 360 px.
 *
 *  - The engine's nouns (apples to count, a cat to match, the book that tells
 *    the child the word) are drawn in COLOUR on the web page, from the colour
 *    picture bank. The WhatsApp PNG path keeps the engine's line art, unchanged.
 *  - A row coloured on purpose (compare mode: "red row vs blue row") keeps its
 *    colour: the bank would erase the difference the question is about.
 *  - Emoji options (today's WhatsApp picture question: 🌸 🍃 🌰 🥕) become big
 *    picture tiles, not 20 px characters in a text button.
 *  - A picture-option row's grid (the WhatsApp collage of the options with
 *    "1. word" painted in) is never the question's picture: the options already
 *    are the pictures, so the child would see every option twice.
 *
 * Supabase is the boundary and is faked; the engine, the bank and E2 run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Fig = require('../../../shared/services/quiz/web-quiz-figure');
const { renderFigureSvg } = require('../../../shared/services/quiz/transcript-quiz-figure');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

const APPLE_RED = '#F8312F'; // the colour bank's apple; the line art has no fill colour at all
const APPLES = { type: 'count_objects', picto: 'apple', count: 5 };

function row(n, media, extra = {}) {
  return {
    id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
    question_text: `How many apples are there?`, option_a: '4', option_b: '5', option_c: '6', option_d: null,
    correct_option: 'B', explanation: 'Count them.', option_feedback: null, media, render_pattern: 'P1', ...extra,
  };
}

function seed(questions, language = 'en') {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Plants', language, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Plants', grade: '3', subject: 'Science', language, meta: {}, quiz_source: 'transcript' }],
    quiz_questions: questions,
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; });
afterAll(() => { process.env = SAVED; });

describe('figures: the engine nouns are colour pictures on the page, line art on WhatsApp', () => {
  test('a counting figure on the page draws colour apples, and passes the allowlist', () => {
    const f = Fig.figureFor(row(1, { figure: APPLES, language: 'en' }));
    expect(f.kind).toBe('svg');
    expect(f.svg).toContain(APPLE_RED);
    expect(Fig.safeSvg(f.svg)).toBeTruthy();
  });

  test('the WhatsApp PNG path (renderFigureSvg) is unchanged: line art, no colour bank', () => {
    const svg = renderFigureSvg(APPLES, 'en');
    expect(svg).not.toContain(APPLE_RED);
    // ... even right after the page drew the same spec (the colour is scoped, never left on)
    Fig.figureFor(row(2, { figure: APPLES, language: 'en' }));
    expect(renderFigureSvg(APPLES, 'en')).not.toContain(APPLE_RED);
  });

  test('a row coloured on purpose keeps its colour (the difference is the question)', () => {
    const spec = { type: 'count_objects', rows: [{ picto: 'apple', count: 3, color: 'cool' }, { picto: 'apple', count: 2, color: 'warn' }] };
    const f = Fig.figureFor(row(3, { figure: spec, language: 'en' }));
    expect(f.kind).toBe('svg');
    expect(f.svg).not.toContain(APPLE_RED);
  });

  test('Urdu figures draw the same colour pictures', () => {
    const f = Fig.figureFor(row(4, { figure: APPLES, language: 'ur' }));
    expect(f.svg).toContain(APPLE_RED);
  });
});

describe('picture options are colour pictures', () => {
  test('a roster pictogram option is the colour drawing', () => {
    const p = Fig.optionPic({ kind: 'pictogram', name: 'apple' }, 'en');
    expect(p.svg).toMatch(/^<svg[^>]*viewBox="0 0 72 72"/);
    expect(p.svg).toContain(APPLE_RED);
    expect(Fig.safeSvg(p.svg)).toBeTruthy();
    expect(p.name).toBe('apple');
  });

  test('a noun the bank lacks keeps its line art (never a blank tile)', () => {
    const p = Fig.optionPic({ kind: 'pictogram', name: 'samosa' }, 'en');
    expect(p).toBeTruthy();
    expect(p.svg).toMatch(/stroke=/);
  });
});

describe('E2: emoji options become picture tiles', () => {
  const LEAF = (lang) => row(5, { language: lang }, {
    question_text: lang === 'ur' ? 'تصویریں دیکھیں۔ ان میں پتا کون سا ہے؟' : 'Look at the pictures. Which one is a LEAF?',
    option_a: '🌸', option_b: '🍃', option_c: '🌰', option_d: '🥕', correct_option: 'B',
  });

  test.each(['en', 'ur'])('%s: every emoji option carries a colour picture and no spoken/visible word that names it', async (lang) => {
    seed([LEAF(lang)], lang);
    const out = await WQ.getQuiz('AB12CD', {});
    const q = out.quiz.questions[0];
    expect(q.options).toHaveLength(4);
    for (const o of q.options) {
      expect(o.pic && o.pic.svg).toBeTruthy();
      expect(Fig.safeSvg(o.pic.svg)).toBeTruthy();
      expect(o.name || '').toBe('');
    }
    const leaf = q.options.find((o) => o.slot === 'B');
    expect(leaf.pic.svg).toContain('#00D26A');
  });

  test('symbol options (= < >) are not pictures', async () => {
    seed([row(6, { language: 'en' }, { question_text: 'Which sign goes in the box? 5 _ 3', option_a: '>', option_b: '<', option_c: '=', correct_option: 'A' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions[0].options.every((o) => !o.pic)).toBe(true);
  });
});

describe('E2: a picture-option grid is never the question picture', () => {
  const B64 = '/9j/4AAQSkZJRgABAQ';
  test('options with their own pictures: the grid collage is not sent as img', async () => {
    seed([row(7, { grid: 'https://r2/quiz-grids/grid_leg_x_3.png', option_images: [{ b64: B64 }, { b64: B64 }] },
      { render_pattern: 'P5', question_text: 'What did the bear think about?', option_a: '1. Food', option_b: '2. Crying', option_c: null, correct_option: 'A' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    const q = out.quiz.questions[0];
    expect(q.img).toBeUndefined();
    expect(q.figure).toBeUndefined();
    expect(q.options.every((o) => o.img)).toBe(true);
  });

  test('a real question picture beside picture options is kept (which picture goes with this one?)', async () => {
    seed([row(8, { question_image: 'https://r2/q.png', grid: 'https://r2/grid.png', option_images: [{ b64: B64 }, { b64: B64 }] },
      { render_pattern: 'P5', question_text: 'Which picture goes with this one?', option_a: 'Picture 1', option_b: 'Picture 2', option_c: null, correct_option: 'A' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    expect(out.quiz.questions[0].img).toBeTruthy();
  });
});

describe('figures: a one-bar fraction picture is tall enough to read at 360 px', () => {
  test('a one- or two-bar fraction figure is drawn at least 1/6 as tall as it is wide on the page', () => {
    const f = Fig.figureFor(row(9, { figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] }, language: 'en' }));
    expect(f.h / f.w).toBeGreaterThanOrEqual(1 / 6);
  });
  test('the WhatsApp drawing of the same spec keeps its own proportions', () => {
    const svg = renderFigureSvg({ type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] }, 'en');
    const [, , w, h] = /viewBox="([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)"/.exec(svg).slice(1).map(Number);
    expect(h / w).toBeLessThan(1 / 6);
  });
  test('a spec that sets its own bar height, and the circle model, are left alone', () => {
    const own = Fig.figureFor(row(10, { figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }], barHeight: 30 }, language: 'en' }));
    expect(own.h / own.w).toBeLessThan(1 / 6);
  });
});

describe('the bank builder keeps only drawings the page can show whole', () => {
  const { normalise } = require('../../../shared/services/quiz/pictures/build_color_bank');
  test('a plain flat drawing is scaled to the 72-unit grid and every element is skipped by the overlap gate', () => {
    const r = normalise('<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1h4v4z" fill="#F8312F"/><circle cx="3" cy="3" r="1" fill="#00D26A"/></svg>');
    expect(r.inner).toMatch(/^<g data-ov="skip" transform="scale\(2\.25\)">/);
    expect((r.inner.match(/<(path|circle) data-ov="skip"/g) || []).length).toBe(2);
    expect(Fig.safeSvg(`<svg viewBox="0 0 72 72">${r.inner}</svg>`)).toBeTruthy();
  });
  test.each([
    ['a filter', '<svg viewBox="0 0 32 32"><g filter="url(#f)"><path d="M1 1"/></g><defs><filter id="f"/></defs></svg>'],
    ['a gradient', '<svg viewBox="0 0 32 32"><path d="M1 1" fill="url(#g)"/></svg>'],
    ['another grid', '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>'],
    ['text', '<svg viewBox="0 0 32 32"><text>A</text></svg>'],
  ])('a drawing with %s is left out (the noun keeps its line art)', (_, svg) => {
    expect(normalise(svg).error).toBeTruthy();
  });
  test('clip-rule (a fill rule, not a clip path) is not refused', () => {
    expect(normalise('<svg viewBox="0 0 32 32"><path clip-rule="evenodd" fill-rule="evenodd" d="M1 1"/></svg>').inner).toBeTruthy();
  });
});
