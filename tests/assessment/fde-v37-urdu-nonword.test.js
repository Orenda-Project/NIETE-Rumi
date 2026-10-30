/**
 * A non-word in an Urdu key (round 6 blocker, bd-5jmnfj.4.58.9.3): v35 G1 Urdu oral poem printed «روشنی کے ہار
 * بھی دیکے». The book (p87 poem, p85 glossary) prints «دمکے»; «دیکے» is the stored text's misread of it, so the
 * poem card and its key both carried a word that does not exist. A known misread is mended where the book text
 * loads and again on the finished paper; a word that only contains the letters (دیکھے) is left alone.
 */

const U = require('../../bot/shared/services/assessment/fde-urdu-nonword');

describe('correctText', () => {
  test('RED mends the misread as a whole word', () => {
    expect(U.correctText('روشنی کے ہار بھی دیکے').text).toBe('روشنی کے ہار بھی دمکے');
    expect(U.correctText('دیکے،').text).toBe('دمکے،');
  });
  test('a real word that holds the same letters is not touched', () => {
    const s = 'جملے کے مطلب کو دیکھے بغیر کوئی بھی لفظ لکھ دینا';
    expect(U.correctText(s).text).toBe(s);
  });
  test('each mend carries a note; non-strings come back as they were', () => {
    expect(U.correctText('ہار بھی دیکے').notes).toHaveLength(1);
    expect(U.correctText(null).text).toBe(null);
  });
});

describe('nonWords', () => {
  test('RED names each known misread in a text', () => {
    expect(U.nonWords('غبارے چمکے، ہار بھی دیکے')).toEqual(['دیکے']);
    expect(U.nonWords('ہار بھی دمکے')).toEqual([]);
  });
});

describe('correctMisreads', () => {
  test('RED mends every string in a paper or a loaded book, never mutating its input', () => {
    const ex = { seen: {}, _layout: { oral: { content: [{ script: 'ہار بھی دیکے', items: [{ ask: 'کیا', answer: 'دیکے' }] }] } } };
    const { value, notes } = U.correctMisreads(ex);
    expect(value._layout.oral.content[0].script).toBe('ہار بھی دمکے');
    expect(value._layout.oral.content[0].items[0].answer).toBe('دمکے');
    expect(notes).toHaveLength(2);
    expect(ex._layout.oral.content[0].script).toBe('ہار بھی دیکے');
    const book = { content: 'روشنی کے ہار بھی دیکے', pages: [87] };
    expect(U.correctMisreads(book).value).toEqual({ content: 'روشنی کے ہار بھی دمکے', pages: [87] });
  });
  test('nothing to mend returns the same object', () => {
    const ex = { a: ['دمکے'] };
    expect(U.correctMisreads(ex).value).toBe(ex);
    expect(U.correctMisreads(null).value).toBe(null);
  });
});

describe('wiring', () => {
  const read = (f) => require('fs').readFileSync(require.resolve(`../../bot/shared/services/assessment/${f}`), 'utf8');
  test('the book text is mended where it loads, and the early paper at the end', () => {
    expect(read('assessment-generation.service.js')).toMatch(/correctMisreads\(/);
    expect(read('fde-early-writer.js')).toMatch(/correctMisreads\(/);
  });
});
