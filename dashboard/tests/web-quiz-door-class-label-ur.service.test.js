/**
 * An English quiz opened on an Urdu page (the quiz door, ?lang=ur): the card's "from <teacher> · <class>" line names the
 * class in Urdu («کلاس ۵»), as the class table already does (wq.js urClassLabel), on both doors (today's landing and
 * the identity v2 door), with the Urdu polish (wq-ur2). An Urdu quiz on an Urdu page and every English page keep the class label as stored.
 * Invented content only.
 */
const { page } = require('./wq-page-harness');

const V2 = (label) => ({ label, teacher: '<Name> Testwala', chips: [], identity: { mode: 'v2', class: { state: 'known', label: '5', ask: null }, roster: true, invited: false } });
const sub = (h) => ((/<p class="wq-sub">([\s\S]*?)<\/p>/.exec(h) || [])[1] || '').replace(/<[^>]+>/g, '');
const door = (o, v2) => page({ ...o, ...(v2 ? { cls: V2(o.label || 'Class 5'), ident: true } : { cls: { label: o.label || 'Class 5', teacher: '<Name> Testwala', chips: [] } }) }).html();

describe.each([['today\'s landing', false], ['the identity v2 door', true]])('%s', (_n, v2) => {
  const swap = (ur2) => ({ lang: 'ur', quizExtra: { lang: 'en' }, bootExtra: { ui_lang: 'ur', ...(ur2 ? { ui: { ur2: true } } : {}) } });
  test('Urdu polish on, an English quiz on an Urdu page: the class reads «کلاس ۵»', () => {
    const line = sub(door(swap(true), v2));
    expect(line).toMatch(/کلاس.۵/);
    expect(line).not.toContain('Class');
  });
  test('Urdu polish off: the label as stored (today)', () => {
    expect(sub(door(swap(false), v2))).toMatch(/Class.5/);
  });
  test('an Urdu quiz on an Urdu page, and an English page: the label as stored', () => {
    expect(sub(door({ lang: 'ur' }, v2))).toMatch(/Class.5/);
    expect(sub(door({ lang: 'en' }, v2))).toMatch(/Class.5/);
  });
});
