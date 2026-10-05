'use strict';
/**
 * The web quiz item (SCHEMA_v2): the item rides BESIDE today's row in
 * quiz_questions.media.web. Supabase and the LLM call are the boundaries and
 * are faked; every first-party gate (maths, Urdu address, pictogram roster)
 * runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../../shared/config/supabase');
const W = require('../../../shared/services/quiz/web-quiz-items');

const TRANSCRIPT = [
  '[00:10] Teacher: Today we will learn about the states of matter.',
  '[03:40] Teacher: Water is a liquid. It flows and takes the shape of the glass.',
  '[07:05] Teacher: First the seed is planted, then it grows roots, then a shoot comes out, and at last we get leaves.',
  '[09:30] Teacher: A stone is a solid. It keeps its own shape.',
].join('\n');

const LP = [
  '## I Do',
  'Show the class that a liquid flows and takes the shape of its container.',
  '## We Do',
  'Pour water from a glass into a bowl and ask what changed.',
].join('\n');

const row = (over = {}) => ({
  question_text: 'Which of these is a liquid?',
  option_a: 'stone', option_b: 'milk', option_c: 'air', correct_option: 'B',
  explanation: 'A liquid flows.', option_feedback: { correct: 'Yes, milk flows.', wrong: { 0: 'A stone keeps its shape.', 2: 'Air is a gas.' } },
  media: {}, render_pattern: 'P1', external_id: 'tq:q:S1:1',
  ...over,
});

const SAVED_ENV = { ...process.env };
afterAll(() => { process.env = SAVED_ENV; });

describe('locateSource: the quote must be in the real source', () => {
  test('a transcript quote is found and stamped with the timestamp above it', () => {
    const r = W.locateSource('water is a liquid, it flows and takes the shape of the glass', { kind: 'transcript', text: TRANSCRIPT });
    expect(r).toEqual({ ok: true, at: '[03:40]' });
  });
  test('a lesson-plan quote is stamped with its section heading', () => {
    const r = W.locateSource('Pour water from a glass into a bowl', { kind: 'lesson_plan', text: LP });
    expect(r).toEqual({ ok: true, section: 'We Do' });
  });
  test('an invented quote is not found; too short or too long is refused', () => {
    expect(W.locateSource('the teacher drew a volcano on the board', { kind: 'transcript', text: TRANSCRIPT }).ok).toBe(false);
    expect(W.locateSource('water', { kind: 'transcript', text: TRANSCRIPT }).ok).toBe(false);
  });
  test('Urdu quotes match across spacing and punctuation', () => {
    const ur = '[02:00] استاد: پانی ایک liquid ہے، یہ بہتا ہے۔';
    expect(W.locateSource('پانی ایک liquid ہے یہ بہتا ہے', { kind: 'transcript', text: ur })).toEqual({ ok: true, at: '[02:00]' });
  });
});

describe('normaliseItem: a web item is checked in code, and falls back to the row', () => {
  const ctx = { language: 'en', source: { kind: 'transcript', text: TRANSCRIPT }, gradeBand: '1-2' };
  test('a picture item keeps the row\'s options and key, adds real pictograms, spoken names and the source', () => {
    const raw = {
      type: 'picture', read: { stem: 'Which of these is a liquid?', opts: ['stone', 'milk', 'air'] },
      pics: ['stone', 'milk', null], source_quote: 'Water is a liquid. It flows and takes the shape of the glass',
      why: 'A liquid flows and takes the shape of its cup.',
    };
    const out = W.normaliseItem(raw, row(), 1, ctx);
    expect(out.item).toMatchObject({
      v: 2, type: 'single', stem: 'Which of these is a liquid?', key: 'B',
      source: { kind: 'transcript', ok: true, at: '[03:40]' }, wa: { from: 'same' },
    });
    // one option has no pictogram: a picture item needs EVERY option drawn -> single, pictures dropped
    expect(out.item.options.every((o) => !o.pic)).toBe(true);
    const full = W.normaliseItem({ ...raw, pics: ['stone', 'milk', 'balloon'] }, row({ option_c: 'balloon' }), 1, ctx);
    expect(full.item.type).toBe('picture');
    expect(full.item.options.map((o) => [o.slot, o.text, o.pic])).toEqual([
      ['A', 'stone', { kind: 'pictogram', name: 'stone' }],
      ['B', 'milk', { kind: 'pictogram', name: 'milk' }],
      ['C', 'balloon', { kind: 'pictogram', name: 'balloon' }],
    ]);
    expect(full.item.options[0].fb).toBe('A stone keeps its shape.');
    expect(full.item.fb_right).toBe('Yes, milk flows.');
  });

  test('a picture must BE its option: never a drawing on a letter or a number, and in English the word names the drawing', () => {
    const letters = row({ question_text: 'Which letter does the fruit start with?', option_a: 'ب', option_b: 'الف', option_c: 'ت', correct_option: 'B' });
    const ur = { language: 'ur', source: { kind: 'transcript', text: '[01:00] الف سے انار، ب سے بکری، ت سے تختی' }, gradeBand: '1-2' };
    const out = W.normaliseItem({ type: 'picture', pics: ['ant', 'pomegranate', 'tree'], source_quote: 'الف سے انار، ب سے بکری' }, letters, 1, ur);
    expect(out.item.type).toBe('single');
    const mismatch = W.normaliseItem({ type: 'picture', pics: ['rock', 'bottle', 'balloon'], source_quote: 'Water is a liquid. It flows and takes the shape of the glass' }, row(), 1, ctx);
    expect(mismatch.item.type).toBe('single');
  });

  test('a pictogram name the roster does not have is never drawn', () => {
    const out = W.normaliseItem({ type: 'picture', pics: ['stone', 'milk', 'unicornish'], source_quote: 'Water is a liquid. It flows and takes the shape of the glass' }, row(), 1, ctx);
    expect(out.item.type).toBe('single');
  });

  test('no quote in the source = no web item (the row ships as today)', () => {
    const out = W.normaliseItem({ type: 'single', source_quote: 'we built a volcano out of clay today' }, row(), 1, ctx);
    expect(out.item).toBeNull();
    expect(out.reason).toBe('source_not_found');
  });

  test('an order item: own steps and an ORDERED key that is a permutation; projected for WhatsApp', () => {
    const raw = {
      type: 'order', stem: 'Put the plant\'s growth in order.',
      options: [{ text: 'leaves come' }, { text: 'seed is planted' }, { text: 'roots grow' }, { text: 'a shoot comes out' }],
      key: 'B,C,D,A', why: 'A plant grows from the seed up: roots first, leaves last.',
      source_quote: 'First the seed is planted, then it grows roots, then a shoot comes out',
    };
    const out = W.normaliseItem(raw, row(), 2, ctx);
    expect(out.item).toMatchObject({ type: 'order', key: 'B,C,D,A', wa: { from: 'projected' }, source: { at: '[07:05]' } });
    expect(W.normaliseItem({ ...raw, key: 'B,C,C,A' }, row(), 2, ctx).item).toBeNull();
    expect(W.normaliseItem({ ...raw, options: raw.options.slice(0, 2), key: 'B,A' }, row(), 2, ctx).item).toBeNull();
  });

  test('a new type is never question 1 (a nervous child gets an easy pick first); true/false is not in the pilot', () => {
    const raw = { type: 'order', stem: 'Put the plant growth in order.', options: [{ text: 'leaves come' }, { text: 'seed is planted' }, { text: 'roots grow' }],
      key: 'B,C,A', why: 'A plant grows from the seed up.', source_quote: 'First the seed is planted, then it grows roots' };
    expect(W.normaliseItem(raw, row(), 0, ctx).reason).toBe('q1_new_type');
    expect(W.normaliseItem(raw, row(), 1, ctx).item).toMatchObject({ type: 'order', key: 'B,C,A' });
    const tf = { type: 'tf', stem: 'Water is a solid.', options: [{ text: 'True' }, { text: 'False' }], key: 'B',
      why: 'Water flows, so it is a liquid.', source_quote: 'Water is a liquid. It flows and takes the shape of the glass' };
    expect(W.normaliseItem(tf, row(), 1, ctx).reason).toBe('not_in_pilot');
  });

  test('the quote must be about the question: it shares a word with the stem or the right answer', () => {
    const out = W.normaliseItem({ type: 'single', source_quote: 'A stone is a solid. It keeps its own shape.' },
      row({ question_text: 'Which of these flows?', option_a: 'rock', option_b: 'juice', option_c: 'brick', correct_option: 'B' }), 1, ctx);
    expect(out.reason).toBe('source_off_topic');
  });

  test('grade 1-2: a new-type stem over 8 words is dropped; a long row stem is flagged for the voice', () => {
    const raw = { type: 'order', stem: 'Look carefully and then put all of these steps of growing into the right order.',
      options: [{ text: 'leaves come' }, { text: 'seed is planted' }, { text: 'roots grow' }], key: 'B,C,A', why: 'A plant grows from the seed up.',
      source_quote: 'First the seed is planted, then it grows roots' };
    expect(W.normaliseItem(raw, row(), 1, ctx).reason).toBe('stem_too_long');
    const long = W.normaliseItem({ type: 'single', source_quote: 'Water is a liquid. It flows and takes the shape of the glass' },
      row({ question_text: 'Which one of these things from the lesson is a liquid that flows?' }), 1, ctx).item;
    expect(long.grade_fit).toMatchObject({ long_stem: true });
  });

  test('wrong-option feedback that is the same line twice is not sent (the why teaches instead)', () => {
    const same = row({ option_feedback: { correct: 'Yes.', wrong: { 0: 'Think again.', 2: 'Think again.' } } });
    const it = W.normaliseItem({ type: 'single', source_quote: 'Water is a liquid. It flows and takes the shape of the glass' }, same, 1, ctx).item;
    expect(it.options.some((o) => o.fb)).toBe(false);
  });

  test('a match item: left column, right options, ordered key', () => {
    const raw = { type: 'match', stem: 'Match each thing to its state.', left: [{ text: 'stone' }, { text: 'water' }, { text: 'air' }],
      options: [{ text: 'gas' }, { text: 'solid' }, { text: 'liquid' }], key: 'B,C,A', why: 'Solids keep their shape, liquids flow, gases spread out.',
      source_quote: 'A stone is a solid. It keeps its own shape.' };
    expect(W.normaliseItem(raw, row(), 3, ctx).item).toMatchObject({ type: 'match', key: 'B,C,A', left: [{ text: 'stone' }, { text: 'water' }, { text: 'air' }] });
    expect(W.normaliseItem({ ...raw, left: raw.left.slice(0, 2) }, row(), 3, ctx).item).toBeNull();
  });

  test('broken maths in a new-type field drops the web item (same texFaults as the row)', () => {
    const raw = { type: 'order', stem: 'Order $\\frac{1}{2 and the rest', options: [{ text: 'leaves come' }, { text: 'seed is planted' }, { text: 'roots grow' }],
      key: 'B,C,A', why: 'A plant grows from the seed up.', source_quote: 'First the seed is planted, then it grows roots' };
    expect(W.normaliseItem(raw, row(), 1, ctx).reason).toBe('maths');
  });

  test('an Urdu web stem that speaks to the child in a gendered verb is dropped (same address gate)', () => {
    const urCtx = { language: 'ur', source: { kind: 'transcript', text: '[01:00] پہلے بیج بویا جاتا ہے پھر جڑیں نکلتی ہیں پھر پتے آتے ہیں' }, gradeBand: '3-5' };
    const raw = { type: 'order', stem: 'آپ ان کو کس ترتیب میں لگائیں گے؟', options: [{ text: 'پتے' }, { text: 'بیج' }, { text: 'جڑیں' }], key: 'B,C,A',
      why: 'پودا بیج سے اگتا ہے۔', source_quote: 'پہلے بیج بویا جاتا ہے پھر جڑیں نکلتی ہیں' };
    expect(W.normaliseItem(raw, row({ question_text: 'بیج سے پہلے کیا نکلتا ہے؟', option_a: 'پتے', option_b: 'جڑیں', option_c: 'پھل' }), 1, urCtx).reason).toBe('urdu_address');
  });
});

describe('capNewTypes: at most two of tf/order/match/label per quiz', () => {
  test('the third new-type item falls back to the row', () => {
    const items = [{ type: 'single' }, { type: 'order' }, { type: 'tf' }, { type: 'match' }, { type: 'picture' }];
    expect(W.capNewTypes(items).map((i) => i && i.type)).toEqual(['single', 'order', 'tf', null, 'picture']);
  });
});

describe('isCorrect: one grader for every type', () => {
  const web = (type, key) => ({ correct_option: 'A', media: { web: { v: 2, type, key } } });
  test('order and match are compared IN ORDER; multi as a set; the row key when no web item', () => {
    expect(W.isCorrect(web('order', 'B,C,D,A'), 'B,C,D,A')).toBe(true);
    expect(W.isCorrect(web('order', 'B,C,D,A'), 'A,B,C,D')).toBe(false);
    expect(W.isCorrect(web('match', 'B,C,A'), 'C,B,A')).toBe(false);
    expect(W.isCorrect(web('multi', 'A,C'), 'C,A')).toBe(true);
    expect(W.isCorrect(web('tf', 'B'), 'B')).toBe(true);
    expect(W.isCorrect({ correct_option: 'B', media: {} }, 'B')).toBe(true);
    expect(W.isCorrect({ correct_option: 'B', media: null }, 'A')).toBe(false);
  });
});

describe('webPayload: what E2 sends for an item', () => {
  test('a web item replaces the text options, sends pictures, read, key, and never the source quote', () => {
    const item = W.normaliseItem({ type: 'picture', pics: ['stone', 'milk', 'balloon'], read: { stem: 'Which one is a liquid?', opts: ['stone', 'milk', 'air'] },
      source_quote: 'Water is a liquid. It flows and takes the shape of the glass' }, row({ option_c: 'balloon' }), 1,
    { language: 'en', source: { kind: 'transcript', text: TRANSCRIPT }, gradeBand: '1-2' }).item;
    const out = W.webPayload({ media: { web: item } });
    expect(out).toMatchObject({
      type: 'picture', text: 'Which of these is a liquid?', correct_slot: 'B', fb_right: 'Yes, milk flows.',
      read: { stem: 'Which one is a liquid?', opts: ['stone', 'milk', 'air'] },
      source: { kind: 'transcript', at: '[03:40]' },
    });
    expect(out.options[1]).toEqual({ slot: 'B', text: 'milk', pic: { kind: 'pictogram', name: 'milk' }, name: 'milk' });
    expect(JSON.stringify(out)).not.toMatch(/takes the shape of the glass/);
    expect(W.webPayload({ media: {} })).toBeNull();
  });
});

describe('webItemsOn: the switch is an app_settings ROW plus the web arm; absent = off', () => {
  const settings = (rows) => {
    supabase.from = jest.fn(() => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }));
  };
  beforeEach(() => { W.__resetCache(); process.env.PORTAL_URL = 'https://portal.example'; });
  test('off without the row, on with it and the teacher on the web arm', async () => {
    settings([{ key: 'web_quiz_enabled', value: 'true' }, { key: 'web_quiz_teachers', value: '"all"' }]);
    expect(await W.webItemsOn('t1')).toBe(false);
    W.__resetCache(); require('../../../shared/services/quiz/web-quiz-link')._resetCache();
    settings([{ key: 'web_quiz_enabled', value: 'true' }, { key: 'web_quiz_teachers', value: '"all"' }, { key: 'web_quiz_items_v2', value: 'true' }]);
    expect(await W.webItemsOn('t1')).toBe(true);
  });
});

describe('attachWebItems: one extra call after the quiz is final; never fails the quiz', () => {
  const ctx = { language: 'en', source: { kind: 'transcript', text: TRANSCRIPT }, gradeBand: '1-2', subject: 'Science', quizId: 'q1' };
  test('attaches media.web to the rows the model upgraded, records cost, leaves the rest as they were', async () => {
    const rows = [row({ option_c: 'balloon' }), row({ question_text: 'Which is a solid?', option_a: 'stone', option_b: 'milk', option_c: 'air', correct_option: 'A' })];
    const complete = jest.fn(async () => ({ json: { items: [
      { q: 0, type: 'picture', pics: ['stone', 'milk', 'balloon'], source_quote: 'Water is a liquid. It flows and takes the shape of the glass' },
      { q: 1, type: 'single', source_quote: 'nothing like this was said in class at all' },
    ] }, costUsd: 0.004, latencyMs: 900, model: 'm' }));
    const out = await W.attachWebItems(rows, ctx, { complete });
    expect(out.rows[0].media.web).toMatchObject({ type: 'picture', key: 'B' });
    expect(out.rows[1].media.web).toBeUndefined();
    expect(out.stats).toMatchObject({ attached: 1, dropped: { source_not_found: 1 }, cost_usd: 0.004 });
    expect(rows[0].media.web).toBeUndefined(); // input not mutated
    const prompt = complete.mock.calls[0][0].prompt;
    expect(prompt).toMatch(/TRANSCRIPT/);
    expect(prompt).toMatch(/states of matter/);
  });
  test('the LLM failing returns the rows unchanged', async () => {
    const rows = [row()];
    const out = await W.attachWebItems(rows, ctx, { complete: async () => { throw new Error('timeout'); } });
    expect(out.rows).toEqual(rows);
    expect(out.stats).toMatchObject({ attached: 0, error: 'timeout' });
  });
});
