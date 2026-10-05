'use strict';
/**
 * Figure content gates behind app_settings `quiz_author_gates_v2` (off by default).
 *
 *  1. Pictures that cannot be told apart are refused: parts drawn with the same
 *     pictogram must differ by something drawn that the stem names.
 *  2. The voice names a picture option by the label that is drawn (P/Q/R), never "Picture A".
 *  3. A place-value stem over a labelled base_ten mat: the column heads are the answer, so they go.
 *  4. A word_blank for a lesson on a mark (tashdeed, zer…) draws that mark on the blank tile.
 *  5. A Grades 6-12 lesson's own diagram specs reach the author.
 *
 * With the flag off every one of these is exactly today's behaviour.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const Gates = require('../../bot/shared/services/quiz/quiz-author-gates');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { renderDiagram } = require('../../bot/vendor/lp-v9/diagrams');
const WebItems = require('../../bot/shared/services/quiz/web-quiz-items');
const Source = require('../../bot/shared/services/quiz/lp612-quiz-source');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');

const SHADDA = 'ّ';

function q(i, over = {}) {
  return {
    slo_id: 'S1', level: 'understand',
    question: `Question ${i}: which word did the lesson use for this idea?`,
    options: [`first word ${i}`, `second word ${i}`, `third word ${i}`],
    correct_index: 2,
    explanation: 'The lesson used the third word for this idea.',
    distractor_misconceptions: { 0: 'mixed up the words', 1: 'picked the other word' },
    option_feedback: { correct: 'Yes, the third word.', wrong: { 0: 'That is the first word.', 1: 'That is the second word.' } },
    ...over,
  };
}
const six = (over = {}) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));
const DIGEST = { subject: 'english', slos: [{ id: 'S1', statement: 's', taught_level: 'understand' }] };
const run = (qs, ctx = {}) => validate(qs, { language: 'en', subject: 'english', digest: DIGEST, nExpected: 6, ...ctx });
const errs = (r) => r.errors.join(' | ');

// The red team's "chilly" item: three identical child pictograms that differ only by colour.
const CHILLY = {
  question: 'Which picture shows someone feeling "chilly"?',
  options: ['R', 'P', 'Q'], correct_index: 1,
  explanation: 'The picture shows someone shivering, which is how a person looks when they feel chilly.',
  figure: {
    type: 'match',
    left: [{ picto: 'child', label: 'P', color: 'cool' }, { picto: 'child', label: 'Q', color: 'warn' }, { picto: 'child', label: 'R', color: 'ink' }],
    right: [{ text: 'Shivering' }, { text: 'Shouting' }, { text: 'Walking on toes' }],
  },
};

describe('the flag', () => {
  test('reads app_settings quiz_author_gates_v2, fails closed', async () => {
    const chain = (value) => ({
      select: () => ({ eq: (k, key) => ({ maybeSingle: async () => ({ data: key === 'quiz_author_gates_v2' ? value : null, error: null }) }) }),
    });
    supabase.from.mockImplementation(() => chain({ key: 'quiz_author_gates_v2', value: true }));
    await expect(Gates.isQuizAuthorGatesV2()).resolves.toBe(true);
    supabase.from.mockImplementation(() => chain(null));
    await expect(Gates.isQuizAuthorGatesV2()).resolves.toBe(false);
    supabase.from.mockImplementation(() => { throw new Error('down'); });
    await expect(Gates.isQuizAuthorGatesV2()).resolves.toBe(false);
  });
  test('the per-quiz scope carries the flag to code that is not handed it; ctx wins', async () => {
    expect(Gates.authorGatesOn({})).toBe(false);
    await Gates.runWithAuthorGates(true, async () => {
      await Promise.resolve();
      expect(Gates.authorGatesOn({})).toBe(true);
      expect(Gates.authorGatesOn({ authorGates: false })).toBe(false);
    });
    expect(Gates.authorGatesOn({})).toBe(false);
  });
});

describe('change 5 — pictures a child cannot tell apart', () => {
  test('flag off: the chilly figure is not refused for it (today)', () => {
    const r = run(six(CHILLY));
    expect(errs(r)).not.toMatch(/FIGURE_INDISTINCT/);
  });
  test('flag on: three identical child drawings that differ only by colour are refused', () => {
    const r = run(six(CHILLY), { authorGates: true });
    expect(errs(r)).toMatch(/q0: FIGURE_INDISTINCT/);
  });
  test('flag on, via the per-quiz scope: refused the same way', async () => {
    await Gates.runWithAuthorGates(true, async () => {
      expect(errs(run(six(CHILLY)))).toMatch(/q0: FIGURE_INDISTINCT/);
    });
  });
  test('the colour is fine when the stem names it', () => {
    expect(Gates.indistinctParts(CHILLY.figure, 'Which child is wearing the blue (cool) colour?')).toBeNull();
    expect(Gates.indistinctParts(CHILLY.figure, CHILLY.question)).toMatch(/child/);
  });
  test('same pictogram, different drawn counts, a "how many" stem: fine', () => {
    const spec = { type: 'count_objects', rows: [{ picto: 'apple', count: 3, label: 'P' }, { picto: 'apple', count: 5, label: 'Q' }] };
    expect(Gates.indistinctParts(spec, 'How many more apples are in row Q than in row P?')).toBeNull();
  });
  test('equal groups that are MEANT to look the same (an array, nothing to choose between): fine', () => {
    // W32b's item 30: "4 equal groups of 8", four identical rows of counters.
    const spec = { type: 'count_objects', rows: [8, 8, 8, 8].map((count) => ({ count, picto: 'counter' })) };
    expect(Gates.indistinctParts(spec, 'تصویر میں دکھائے گئے 4 equal groups of 8 کے لیے کون سا ضرب کا جملہ صحیح ہے؟', ['4 × 8 = 32', '4 + 8 = 12', '8 × 4 = 32'])).toBeNull();
  });
  test('different pictograms: fine', () => {
    const spec = { type: 'match', left: [{ picto: 'apple', label: 'P' }, { picto: 'cat', label: 'Q' }, { picto: 'bus', label: 'R' }], right: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
    expect(Gates.indistinctParts(spec, 'Which one is a fruit?')).toBeNull();
  });
});

describe('change 5 — the voice uses the labels that are drawn', () => {
  const row = {
    question_text: CHILLY.question, option_a: 'R', option_b: 'P', option_c: 'Q', correct_option: 'B',
    explanation: CHILLY.explanation, option_feedback: { correct: 'Yes.', wrong: {} },
    external_id: 'tq:x:S6:6', media: { figure: CHILLY.figure, display_order: [0, 1, 2] },
  };
  const raw = {
    type: 'single', source_quote: 'Who is feeling cold? Is there a picture where someone is feeling cold?',
    read: { stem: CHILLY.question, opts: ['Picture A', 'Picture B', 'Picture C'] }, why: 'Someone shivering feels chilly and cold.',
  };
  const ctx = { language: 'en', gradeBand: '3-5', source: { kind: 'transcript', text: 'Chilli feeling cold. Who is feeling cold? Is there a picture where someone is feeling cold? Yes.' } };
  test('flag off: "Picture A" is what the voice says (today)', () => {
    const { item } = WebItems.normaliseItem(raw, row, 2, ctx);
    expect(item.read.opts).toEqual(['Picture A', 'Picture B', 'Picture C']);
  });
  test('flag on: the voice says the drawn labels R, P, Q', () => {
    const { item } = WebItems.normaliseItem(raw, row, 2, { ...ctx, authorGates: true });
    expect(item.read.opts).toEqual(['R', 'P', 'Q']);
    expect(item.options.map((o) => o.name)).toEqual(['R', 'P', 'Q']);
  });
  test('flag on: two options drawn with the same pictogram do not become a picture item', () => {
    const pr = {
      question_text: 'Which one can fly?', option_a: 'A bird', option_b: 'A bird on the ground', option_c: 'A cat',
      correct_option: 'A', explanation: 'A bird can fly.', option_feedback: { correct: 'Yes.', wrong: {} }, external_id: 'tq:x:S1:1',
    };
    const pRaw = { type: 'picture', pics: ['bird', 'bird', 'cat'], source_quote: 'A bird can fly.', read: { stem: 'Which one can fly?', opts: ['bird', 'bird', 'cat'] }, why: 'A bird can fly.' };
    const pCtx = { language: 'en', gradeBand: '3-5', source: { kind: 'transcript', text: 'Look. A bird can fly. A cat cannot fly.' } };
    expect(WebItems.normaliseItem(pRaw, pr, 2, pCtx).item.type).toBe('picture');
    expect(WebItems.normaliseItem(pRaw, pr, 2, { ...pCtx, authorGates: true }).item.type).toBe('single');
  });
});

describe('base_ten — a place-value stem never reads its answer off a column head', () => {
  // Prod 6b7b·4: 490, "which place is the 9 in?", the 9 rods sat under «دہائیاں».
  const PV = {
    question: 'In the picture, in which place is the 9?', options: ['ones', 'hundreds', 'tens'], correct_index: 2,
    explanation: 'The 9 rods are nine tens, so the 9 is in the tens place.',
    figure: { type: 'base_ten', hundreds: 4, tens: 9, ones: 0 },
  };
  const DIG = { subject: 'maths', slos: [{ id: 'S1', statement: 'place value', taught_level: 'understand' }] };
  const runM = (qs, ctx = {}) => validate(qs, { language: 'ur', subject: 'maths', digest: DIG, nExpected: 6, ...ctx });
  test('the engine can draw a mat with no column heads', () => {
    const svg = renderDiagram({ type: 'base_ten', hundreds: 4, tens: 9, ones: 0, lang: 'ur', labels: false });
    expect(svg).not.toMatch(/دہائیاں|سینکڑے|اکائیاں/);
    const withHeads = renderDiagram({ type: 'base_ten', hundreds: 4, tens: 9, ones: 0, lang: 'ur' });
    expect(withHeads).toMatch(/دہائیاں/);
  });
  test('flag off: the heads are drawn (today)', () => {
    const r = runM(six(PV));
    expect(r.questions[0].figureSvg).toMatch(/دہائیاں/);
  });
  test('flag on: the heads are dropped from the stored spec and the drawing', () => {
    const r = runM(six(PV), { authorGates: true });
    expect(r.questions[0].figure.labels).toBe(false);
    expect(r.questions[0].figureSvg).not.toMatch(/دہائیاں|سینکڑے|اکائیاں/);
  });
  test('flag on: a "what number" stem keeps its heads', () => {
    const r = runM(six({ ...PV, question: 'What number does the picture show?', options: ['409', '490', '940'], correct_index: 1, explanation: '4 hundreds and 9 tens make 490.' }), { authorGates: true });
    expect(r.questions[0].figure.labels).toBeUndefined();
  });
});

describe('word_blank — the mark the lesson teaches is on screen', () => {
  // Prod b628·4: گنّا, "a tashdeed word", tiles گ ▢ ا with no shadda anywhere.
  const TB = {
    question: 'تشدید والے لفظ گنّا میں خالی خانے میں کون سا حرف آئے گا؟',
    options: ['نّ', 'مّ', 'تّ'], correct_index: 0,
    explanation: 'گنّا میں ن پر تشدید ہے۔',
    figure: { type: 'word_blank', word: 'گنّا', blanks: [1] },
  };
  const DIG = { subject: 'urdu', slos: [{ id: 'S1', statement: 'tashdeed', taught_level: 'recall' }] };
  const runU = (qs, ctx = {}) => validate(qs, { language: 'ur', subject: 'urdu', digest: DIG, nExpected: 6, ...ctx });
  test('the engine can draw the blank tile with its mark', () => {
    expect(renderDiagram({ type: 'word_blank', word: 'گنّا', blanks: [1], keepMarks: true })).toContain(SHADDA);
    expect(renderDiagram({ type: 'word_blank', word: 'گنّا', blanks: [1] })).not.toContain(SHADDA);
  });
  test('flag off: no shadda (today)', () => {
    const r = runU(six(TB));
    expect(r.questions[0].figureSvg || '').not.toContain(SHADDA);
  });
  test('flag on: the shadda is drawn on the blank', () => {
    const r = runU(six(TB), { authorGates: true });
    expect(r.questions[0].figure.keepMarks).toBe(true);
    expect(r.questions[0].figureSvg).toContain(SHADDA);
  });
  test('flag on: the prod row wrote the word with no shadda at all (گنا) — refused so the retry writes it', () => {
    const prod = { ...TB, question: "خالی جگہ میں صحیح حرف بھر کر 'تشدید' والا لفظ مکمل کریں:", options: ['ن', 'ا', 'گ'], correct_index: 0,
      figure: { type: 'word_blank', word: 'گنا', style: 'tiles', blanks: [1] } };
    expect(errs(runU(six(prod)))).not.toMatch(/FIGURE_MARK_MISSING/);
    expect(errs(runU(six(prod), { authorGates: true }))).toMatch(/q0: FIGURE_MARK_MISSING/);
    expect(Gates.markMissing({ type: 'word_blank', word: 'گنّا', blanks: [1] }, prod.question)).toBeNull();
  });
  test('flag on: when the options differ by the mark, the mark IS the answer and stays hidden', () => {
    const spec = { type: 'word_blank', word: 'گنّا', blanks: [1] };
    expect(Gates.markFix(spec, { stem: TB.question, options: ['نّ', 'ن', 'نِ'] })).toBeNull();
    expect(Gates.markFix(spec, { stem: TB.question, options: TB.options })).toEqual({ ...spec, keepMarks: true });
  });
});

describe('change 7 — a 6-12 lesson\'s own diagrams reach the author', () => {
  const DOC = {
    provenance: { grade: 9, subject: 'maths', topic: 'Percentages' },
    objectives: { outcome: 'find a percentage of a grid' },
    sections: [
      { id: 'development', blocks: [
        { type: 'diagram', id: 'd1', spec: { type: 'grid', rows: 10, cols: 10, shaded: 25, caption: '25 of 100 squares' } },
        { type: 'diagram', id: 'd2', spec: { type: 'mindmap', centre: { label: 'x' } } },
      ] },
      { id: 'homework', blocks: [{ type: 'diagram', id: 'h1', spec: { type: 'grid', rows: 2, cols: 5, shaded: 3 } }] },
    ],
    page2: { board_final: { diagram: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 1 }] } } },
  };
  test('toSlideScript maps the lesson diagrams (never the homework\'s)', () => {
    const ss = Source.toSlideScript(DOC, { lang: 'en' });
    expect(ss.diagrams.map((d) => d.spec.type)).toEqual(['grid', 'mindmap', 'fraction_bar']);
  });
  test('the author block lists only the ones the quiz can draw, as specs to copy', () => {
    const block = LpDigest.lessonDiagramsBlock(Source.toSlideScript(DOC, { lang: 'en' }));
    expect(block).toContain('"type":"grid"');
    expect(block).toContain('"shaded":25');
    expect(block).toContain('"type":"fraction_bar"');
    expect(block).not.toContain('mindmap');
    expect(block).not.toContain('"cols":5');
  });
  test('lessonDrewFor: flag off is exactly today\'s lessonDrewBlock; flag on adds the diagrams', () => {
    const ss = Source.toSlideScript(DOC, { lang: 'en' });
    expect(LpDigest.lessonDrewFor(ss, { authorGates: false })).toBe(LpDigest.lessonDrewBlock(ss));
    expect(LpDigest.lessonDrewFor(ss, { authorGates: true })).toContain('"shaded":25');
  });
  test('a K-5 slide script with no diagrams adds nothing', () => {
    expect(LpDigest.lessonDiagramsBlock({ goal: 'x' })).toBe('');
  });
});

describe('change 5 — the options name only labels that are drawn; a drawn count is not the key', () => {
  // W32b item 9: options R/P/Q, but the clock engine draws ONE clock labelled P.
  const CLOCKS = {
    question: 'Which picture shows being on time?', options: ['R', 'P', 'Q'], correct_index: 1,
    explanation: 'School starts at eight, so the clock at eight shows being on time.',
    figure: { type: 'clock', time: '8:00', label: 'P', rows: [{ time: '8:00', label: 'P' }, { time: '9:00', label: 'Q' }, { time: '8:30', label: 'R' }] },
  };
  test('flag off: not refused for it (today)', () => {
    expect(errs(run(six(CLOCKS)))).not.toMatch(/FIGURE_HANDLE_UNDRAWN/);
  });
  test('flag on: options Q and R name pictures that are not drawn', () => {
    expect(errs(run(six(CLOCKS), { authorGates: true }))).toMatch(/q0: FIGURE_HANDLE_UNDRAWN/);
  });
  // W32b item 17: "which number leaves one over in pairs? look at the counters" over a frame of exactly 7, keyed 7.
  const FRAME = {
    question: 'Which of these numbers, when grouped into pairs, will leave one item remaining? Look at the counters to help you decide.',
    options: ['4', '7', '8'], correct_index: 1, explanation: 'Seven in pairs is three pairs and one left over.',
    figure: { type: 'count_frame', count: 7 },
  };
  const DIG = { subject: 'maths', slos: [{ id: 'S1', statement: 'odd and even', taught_level: 'understand' }] };
  const runM = (qs, ctx = {}) => validate(qs, { language: 'en', subject: 'maths', digest: DIG, nExpected: 6, ...ctx });
  test('flag on: a picture that draws only the key, under a stem that is not "how many", is refused', () => {
    expect(errs(runM(six(FRAME)))).not.toMatch(/FIGURE_SHOWS_KEY/);
    expect(errs(runM(six(FRAME), { authorGates: true }))).toMatch(/q0: FIGURE_SHOWS_KEY/);
  });
  test('"how many counters?" over the same frame is counting, not a leak', () => {
    expect(Gates.drawnCountIsKey(FRAME.figure, 'How many counters are there?', ['6', '7', '8'], 1)).toBeNull();
  });
});

