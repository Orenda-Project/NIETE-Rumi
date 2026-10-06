'use strict';
/**
 * The mascot's hint: one sentence a stuck child can ask for BEFORE answering.
 * It is written by the web item call (one more field in the same reply), held
 * to a leak check in code (a hint that gives the answer away is dropped, the
 * item is kept), carried to the page, and recorded as its own clip.
 *
 * Boundaries faked: supabase, the loggers, R2, the voice gateway. The item
 * normaliser, the leak check, the payload and the publish step run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `r2:${k}`),
}));
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS-fake'), provider: 'soniox', durationSec: 1 })),
}));

const W = require('../../../shared/services/quiz/web-quiz-items');
const Hint = require('../../../shared/services/quiz/web-quiz-hint');
const GatesV2 = require('../../../shared/services/quiz/quiz-author-gates-v2');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const Media = require('../../../shared/services/quiz/web-quiz-media');
const tts = require('../../../shared/services/tts');

const TRANSCRIPT = [
  '[00:10] Teacher: Today we will learn about the states of matter.',
  '[03:40] Teacher: Water is a liquid. It flows and takes the shape of the glass.',
  '[07:05] Teacher: First the seed is planted, then it grows roots, then a shoot comes out, and at last we get leaves.',
].join('\n');

const row = (over = {}) => ({
  question_text: 'Which of these is a liquid?',
  option_a: 'stone', option_b: 'milk', option_c: 'air', correct_option: 'B',
  explanation: 'A liquid flows.', option_feedback: { correct: 'Yes, milk flows.', wrong: { 0: 'A stone keeps its shape.', 2: 'Air is a gas.' } },
  media: {}, render_pattern: 'P1', external_id: 'tq:q:S1:1',
  ...over,
});
const ctx = (over = {}) => ({ language: 'en', source: { kind: 'transcript', text: TRANSCRIPT }, gradeBand: '3-5', authorGates: true, ...over });
const raw = (over = {}) => ({
  type: 'single', read: { stem: 'Which of these is a liquid?', opts: ['stone', 'milk', 'air'] },
  source_quote: 'Water is a liquid. It flows and takes the shape of the glass',
  why: 'A liquid flows and takes the shape of its cup.',
  hint: 'Think about what happens when you pour it into a glass.',
  ...over,
});

afterEach(() => { GatesV2.resetForTests(); jest.clearAllMocks(); });

describe('leaks(): a hint may point the way, never give the answer', () => {
  const item = { type: 'single', stem: 'Which of these is a liquid?', key: 'B',
    options: [{ slot: 'A', text: 'stone' }, { slot: 'B', text: 'milk' }, { slot: 'C', text: 'air' }] };
  test('a hint that points at the lesson passes', () => {
    expect(Hint.leaks('Think about what happens when you pour it into a glass.', item)).toEqual([]);
  });
  test('naming the right answer is a leak', () => {
    expect(Hint.leaks('Milk is something you can pour.', item)).toContain('names_option');
  });
  test('naming a wrong option (ruling it out) is a leak too', () => {
    expect(Hint.leaks('A stone keeps its own shape, so not that one.', item)).toContain('names_option');
  });
  test('a plural or a different case of the answer is still the answer', () => {
    expect(Hint.leaks('MILKS can be poured.', item)).toContain('names_option');
  });
  test('the number that is the key is a leak; a number in the stem is not', () => {
    const sum = { type: 'single', stem: 'What is 4 + 3?', key: 'C',
      options: [{ slot: 'A', text: '6' }, { slot: 'B', text: '8' }, { slot: 'C', text: '7' }] };
    expect(Hint.leaks('Start at 4 and count on 3 more.', sum)).toEqual([]);
    expect(Hint.leaks('Count on from 4 and you reach 7.', sum)).toContain('names_option');
    expect(Hint.leaks('Count on from ۴ and you reach ۷.', sum)).toContain('names_option');
  });
  test('the key picture named in the hint is a leak', () => {
    const pic = { type: 'picture', stem: 'Which one gives us milk?', key: 'A',
      options: [{ slot: 'A', text: '🐄', pic: { kind: 'pictogram', name: 'cow' } }, { slot: 'B', text: '🐔', pic: { kind: 'pictogram', name: 'hen' } }] };
    expect(Hint.leaks('Think of the farm animal that says moo, the cow.', pic)).toContain('names_option');
  });
  test('an Urdu hint is matched without its diacritics', () => {
    const ur = { type: 'single', stem: 'ان میں سے مائع کون سا ہے؟', key: 'B',
      options: [{ slot: 'A', text: 'پتھر' }, { slot: 'B', text: 'دودھ' }, { slot: 'C', text: 'ہوا' }] };
    expect(Hint.leaks('سوچیں، گلاس میں ڈالنے سے کیا بہتا ہے؟', ur)).toEqual([]);
    expect(Hint.leaks('دُودھ بہتا ہے۔', ur)).toContain('names_option');
  });
  test('a missing-letter tile: saying the whole word gives the letter away', () => {
    const blank = { type: 'single', stem: 'What is the missing letter?', key: 'C',
      options: [{ slot: 'A', text: 'P' }, { slot: 'B', text: 'C' }, { slot: 'C', text: 'K' }],
      figure: { spec: { type: 'word_blank', word: 'SKY', blanks: [1] } } };
    expect(Hint.leaks('Look up on a sunny day: what is blue above you?', blank)).toEqual([]);
    expect(Hint.leaks('It is the word sky.', blank)).toContain('figure_word');
  });
  test('a clue to the FORM of the answer is a leak: its sound, its first letter, a name it resembles', () => {
    const lang = { type: 'single', stem: 'بلوچستان کے لوگ کون سی زبان بولتے ہیں؟', key: 'C',
      options: [{ slot: 'A', text: 'پنجابی' }, { slot: 'B', text: 'سندھی' }, { slot: 'C', text: 'بلوچی' }] };
    expect(Hint.leaks('بلوچستان کے نام سے ملتی جلتی زبان کا نام یاد کریں۔', lang)).toContain('form_clue');
    expect(Hint.leaks('It sounds like the name of the province.', item)).toContain('form_clue');
    expect(Hint.leaks('The word starts with the letter m.', item)).toContain('form_clue');
    expect(Hint.leaks('یاد کریں کہ کلاس میں صوبوں کے بارے میں کیا بات ہوئی تھی۔', lang)).toEqual([]);
  });
  test('real hints from a model run (10 lessons): what must pass and what must not', () => {
    const sub = { type: 'single', stem: 'Bunty has 20 toys. He picks 7 up. How many remain?', key: 'A',
      options: [{ slot: 'A', text: '13' }, { slot: 'B', text: '27' }, { slot: 'C', text: '12' }] };
    expect(Hint.leaks('Start with 20 and count back 7 numbers.', sub)).toEqual([]);
    const den = { type: 'single', stem: 'What does the denominator tell us in a fraction?', key: 'B',
      options: [{ slot: 'A', text: 'The total number of wholes' }, { slot: 'B', text: 'How many equal parts the whole is cut into' }, { slot: 'C', text: 'How many parts we take' }] };
    // "number" is a word only a WRONG option has: a generic word, not a give-away.
    expect(Hint.leaks("Recall what the teacher said about the 'bottom number' of a fraction.", den)).toEqual([]);
    const back = { type: 'single', stem: 'What is the bigger number?', key: 'B',
      options: [{ slot: 'A', text: 'The number that is left' }, { slot: 'B', text: 'The number you start with' }, { slot: 'C', text: 'The number you take away' }] };
    // "start" is a word only the KEY has.
    expect(Hint.leaks('Think about where you start when you count back.', back)).toContain('names_option');
    const core = { type: 'single', stem: "Which two layers are part of the Earth's core?", key: 'A',
      options: [{ slot: 'A', text: 'outer core and inner core' }, { slot: 'B', text: 'mantle and outer core' }, { slot: 'C', text: 'crust and mantle' }] };
    expect(Hint.leaks("Think about the names of the layers that include the word 'core'.", core)).toContain('form_clue');
  });
  test('saying "the answer is" is a leak whatever follows', () => {
    expect(Hint.leaks('The answer is the one that flows.', item)).toContain('says_answer');
    expect(Hint.leaks('صحیح جواب وہ ہے جو بہتا ہے۔', item)).toContain('says_answer');
  });
});

describe('normaliseItem: the hint rides on the item, or is dropped alone', () => {
  test('gates on: a clean hint is kept with its spoken form', () => {
    const { item } = W.normaliseItem(raw(), row(), 1, ctx());
    expect(item).toBeTruthy();
    expect(item.hint).toEqual({ text: 'Think about what happens when you pour it into a glass.', read: 'Think about what happens when you pour it into a glass.' });
  });
  test('gates on: a leaking hint is dropped and the item is still attached', () => {
    const { item, hintDropped } = W.normaliseItem(raw({ hint: 'Milk flows, so pick milk.' }), row(), 1, ctx());
    expect(item).toBeTruthy();
    expect(item.hint).toBeUndefined();
    expect(hintDropped).toBe('names_option');
  });
  test('gates off: no hint, exactly as before', () => {
    const { item } = W.normaliseItem(raw(), row(), 1, ctx({ authorGates: false }));
    expect(item.hint).toBeUndefined();
  });
  test('a hint longer than one short sentence is dropped', () => {
    const long = 'Think about it. '.repeat(12);
    const { item, hintDropped } = W.normaliseItem(raw({ hint: long }), row(), 1, ctx());
    expect(item.hint).toBeUndefined();
    expect(hintDropped).toBe('too_long');
  });
  test('an order item: a hint listing two steps gives the order away', () => {
    const order = {
      type: 'order', stem: 'Put these in the order they happen.',
      options: [{ text: 'roots grow' }, { text: 'the seed is planted' }, { text: 'leaves come' }], key: 'B,A,C',
      source_quote: 'First the seed is planted, then it grows roots, then a shoot comes out', why: 'A plant grows from a seed.', fb_right: 'Yes!',
      read: { stem: 'Put these in the order they happen.', opts: ['roots grow', 'the seed is planted', 'leaves come'] },
      hint: 'First the seed is planted, then roots grow.',
    };
    const { item, hintDropped } = W.normaliseItem(order, row(), 2, ctx());
    expect(item).toBeTruthy();
    expect(item.hint).toBeUndefined();
    expect(hintDropped).toBe('names_option');
    const ok = W.normaliseItem({ ...order, hint: 'Think about what a farmer does on the very first day.' }, row(), 2, ctx());
    expect(ok.item.hint.text).toBe('Think about what a farmer does on the very first day.');
  });
});

describe('the prompt asks for a hint only when the gates are on', () => {
  test('on: the hint field and its rule are in the prompt', () => {
    const p = W.buildPrompt([row()], ctx());
    expect(p).toMatch(/"hint"/);
    expect(p).toMatch(/NEVER/);
  });
  test('on: the reply template itself carries a "hint" field (a model copies the template\'s fields)', () => {
    const p = W.buildPrompt([row()], ctx());
    const tpl = p.slice(p.lastIndexOf('Return ONLY this JSON object'));
    expect((tpl.match(/"hint": ""/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  test('off: the prompt is as before', () => {
    expect(W.buildPrompt([row()], ctx({ authorGates: false }))).not.toMatch(/"hint"/);
  });
});

describe('attachWebItems counts hints kept and dropped', () => {
  test('stats.hints and stats.hint_dropped', async () => {
    const complete = jest.fn(async () => ({ json: { items: [
      { q: 0, ...raw() },
      { q: 1, ...raw({ hint: 'It is milk.' }) },
    ] } }));
    const { rows, stats } = await W.attachWebItems([row(), row()], ctx(), { complete });
    expect(rows[0].media.web.hint.text).toMatch(/pour/);
    expect(rows[1].media.web.hint).toBeUndefined();
    expect(stats.hints).toBe(1);
    expect(stats.hint_dropped).toEqual({ names_option: 1 });
  });
});

describe('the page payload carries the hint text, never more', () => {
  test('webPayload has hint.text', () => {
    const { item } = W.normaliseItem(raw(), row(), 1, ctx());
    const q = row({ media: { web: item } });
    expect(W.webPayload(q).hint).toEqual({ text: 'Think about what happens when you pour it into a glass.' });
  });
  test('no hint, no key', () => {
    const { item } = W.normaliseItem(raw(), row(), 1, ctx({ authorGates: false }));
    expect('hint' in W.webPayload(row({ media: { web: item } }))).toBe(false);
  });
});

describe('the hint is recorded as its own clip and signed for the page', () => {
  function fakeDb(quiz, questions) {
    const updates = [];
    const chain = (table) => {
      const c = {
        select() { return c; }, eq() { return c; }, order() { return Promise.resolve({ data: questions, error: null }); },
        maybeSingle() { return Promise.resolve({ data: quiz, error: null }); },
        update(v) { updates.push({ table, v }); return { eq: () => Promise.resolve({ error: null }) }; },
      };
      return c;
    };
    return { from: chain, updates };
  }
  test('publish records part "hint" in the hint\'s own words and stores audio.hint', async () => {
    const { item } = W.normaliseItem(raw(), row(), 1, ctx());
    const q = { id: '11111111-2222-3333-4444-555555555555', ...row({ media: { web: item } }), sort_order: 1 };
    const db = fakeDb({ id: 'quiz-1', language: 'en', meta: {} }, [q]);
    const out = await Publish.publishQuizAudio('quiz-1', { db });
    expect(out.ok).toBe(true);
    const said = tts.synthesize.mock.calls.map((c) => c[0].text);
    expect(said).toContain('Think about what happens when you pour it into a glass.');
    const saved = db.updates[0].v.meta.web.audio[q.id];
    expect(saved.hint).toMatch(/\/hint-[0-9a-f]+\.ogg$/);
  });
  test('presignAudio signs audio.hint', async () => {
    const out = await Media.presignAudio({ web: { audio: { q1: { q: 'k/q.ogg', opts: [], why: null, hint: 'k/hint-ab.ogg' } } } });
    expect(out.q1.hint).toMatch(/hint-ab\.ogg/);
  });
});
