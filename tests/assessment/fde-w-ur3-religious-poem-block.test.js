/**
 * W-UR3 (bd-5jmnfj.35): G1/G2 Urdu oral poem. (1) the poem page citation runs end to end through the writer with
 * book text carrying «=== Page N ===» markers; (2) a poem that is STILL religious after the one re-ask fails the
 * paper closed (ORAL_RELIGIOUS_POEM) instead of shipping.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { religiousPoemLeft } = require('../../bot/shared/services/assessment/fde-oral-religious-block');
const { run } = require('./helpers/early-writer-harness');

const P = Patterns.subjectOf('fde_g1_2026', 'urdu');
const NATURE = 'میرا ستارا سب کو بناتا ہے۔ ستارا ہی ستارا کا';
const HAMD = 'پیڑ اور پودے\nسب کو بنایا میرے خدا نے';
const BOOK = `=== Page 12 ===\nکچھ اور سبق\n=== Page 13 ===\n${NATURE}\n=== Page 14 ===\nآگے کا سبق`;
const ASKS = ['نظم میں کس کو بنایا گیا؟', 'پھول کس نے بنائے؟', 'چاند کس نے بنایا؟', 'ہم کس کا شکر ادا کرتے ہیں؟', 'نظم کا عنوان کیا ہے؟'];
const ITEMS = ASKS.map((ask, i) => ({ ask, answer: ['سب کو', 'ستارا ہی', 'بناتا ہے', 'ستارا کا', 'میرا ستارا'][i] })); // clean answers, all from the poem
const tree = (poem) => ({ oral: P.oral.tasks.map((t) => ({
  id: t.id, script: t.id === 'poem' ? poem : 'ایک چھوٹی سی کہانی',
  items: t.id === 'poem' ? ITEMS : Array.from({ length: t.n }, (_, i) => ({ ask: `سوال ${i + 1}`, answer: `جواب ${i + 1}` })),
})) });
const poemOf = (out) => out.examJson._layout.oral.content.find((c) => c.id === 'poem');

describe('W-UR3 poem page, end to end through the writer', () => {
  test('the poem entry carries the book page found in the book text', async () => {
    const { go } = run(1, 'urdu', { book: BOOK, oralReplies: [tree(NATURE)] });
    expect(poemOf(await go()).page).toBe(13);
  });
});

describe('W-UR3 a religious poem that survives the re-ask fails closed', () => {
  test('religious twice: ORAL_RELIGIOUS_POEM, asked again once first', async () => {
    const { calls, go } = run(1, 'urdu', { book: BOOK, oralReplies: [tree(HAMD), tree(HAMD)] });
    const err = await go().catch((e) => e);
    expect(calls.oral).toHaveLength(2);
    expect(err.code).toBe('ORAL_RELIGIOUS_POEM');
  });
  test('religious first, clean second: the paper ships with the clean poem', async () => {
    const { go } = run(1, 'urdu', { book: BOOK, oralReplies: [tree(HAMD), tree(NATURE)] });
    expect(poemOf(await go()).script).toBe(NATURE);
  });
  test('helper: only a flagged poem with a religious script is blocked', () => {
    const c = (script) => ({ content: [{ id: 'poem', script, items: ITEMS }], flagged: ['poem'] });
    expect(religiousPoemLeft(c(HAMD))).toBe(true);
    expect(religiousPoemLeft(c(NATURE))).toBe(false);
    expect(religiousPoemLeft({ content: c(HAMD).content, flagged: [] })).toBe(false);
    expect(religiousPoemLeft(null)).toBe(false);
  });
});
