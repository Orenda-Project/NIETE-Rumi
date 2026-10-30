/**
 * v29 G5 key points that pay for what the paper never asked: Urdu Q7 «خوشی» in the helper list (the picture does not
 * show it); English Q7 and Q8 a length point for a length the paper never sets.
 */
const { langFixes } = require('../../bot/shared/services/assessment/fde-g5-lang-fixes');

const pts = (arr) => arr.map(([text, marks]) => ({ text, marks, kind: 'A' }));
const sum = (q) => q.scheme.points.reduce((s, p) => s + p.marks, 0);

describe('English Q7 and Q8: no length point the paper never sets', () => {
  const q = (slot, points, extra = {}) => ({ slot, question: 'x', answer: 'a', scheme: { points: pts(points) }, ...extra });

  test('a point that pays for length is dropped, its marks move to the first point, total unchanged', () => {
    const notes = [];
    const item = q('english.C.Q8', [['A topic sentence', 2], ['Details', 3], ['Neatness and length: about 8 sentences', 1]]);
    const out = langFixes(item, { slot: 'english.C.Q8', kinds: ['paragraph'] }, notes);
    expect(out.scheme.points).toHaveLength(2);
    expect(out.scheme.points[0].marks).toBe(3);
    expect(sum(out)).toBe(6);
    expect(notes.join(' ')).toMatch(/length/);
  });

  test('kept when the slot states a length', () => {
    const item = q('english.C.Q8', [['Topic', 2], ['Length: 8 sentences', 1]]);
    const out = langFixes(item, { slot: 'english.C.Q8', kinds: ['paragraph'], instruction_en: 'Write 8 to 10 sentences.' }, []);
    expect(out.scheme.points).toHaveLength(2);
  });

  test('other slots are left alone', () => {
    const item = q('english.A.Q2', [['Topic', 2], ['Length: 8 sentences', 1]]);
    expect(langFixes(item, { slot: 'english.A.Q2' }, [])).toBe(item);
  });
});

describe('Urdu Q7: خوشی is not in the helper list', () => {
  const slot = { slot: 'urdu.C.Q7', kinds: ['picture_description'] };
  const q = (words) => ({ slot: 'urdu.C.Q7', question: 'x', answer: 'a', words, scheme: { points: pts([['چھ دیے گئے الفاظ کا درست استعمال', 3]]) } });

  test('dropped when 6 or more words remain', () => {
    const out = langFixes(q(['شیر', 'ہاتھی', 'ٹکٹ', 'پنجرہ', 'بچے', 'درخت', 'خوشی']), slot, []);
    expect(out.words).not.toContain('خوشی');
    expect(out.words).toHaveLength(6);
  });

  test('kept when dropping would leave fewer than 6', () => {
    const words = ['شیر', 'ہاتھی', 'ٹکٹ', 'پنجرہ', 'خوشی', 'درخت'];
    expect(langFixes(q(words), slot, []).words).toEqual(words);
  });
});
