/** langGiveaways joins the five G5 language detectors of v34 into one list for fde-g5-paper-giveaways. */
const { langGiveaways } = require('../../bot/shared/services/assessment/fde-g5-lang-giveaways');
const urdu = require('./fixtures/fde-v34-g5-urdu-v29.json');
const english = require('./fixtures/fde-v34-g5-english-v29.json');

describe('langGiveaways', () => {
  test('Urdu v29: one Q1 flag for item 5, one for items 3 and 6, one for لقب', () => {
    const f = langGiveaways(urdu);
    expect(f.length).toBeGreaterThanOrEqual(3);
    expect(f.every((x) => x.slot === 'urdu.A.Q1' && x.reason === 'giveaway' && x.with.length > 0 && x.with.length === x.text.length)).toBe(true);
    const text = f.flatMap((x) => x.text).join(' ');
    ['ایٹم بم', 'ہراول دستہ', 'تاب کاری', 'لقب'].forEach((t) => expect(text).toContain(t));
  });

  test('English v29: advice modals, exclamatory, tense cap and quoted key are all there', () => {
    const f = langGiveaways(english);
    const slots = f.map((x) => x.slot);
    expect(slots).toEqual(expect.arrayContaining(['english.A.Q1a', 'english.A.Q1b', 'english.B.Q2']));
    const words = f.flatMap((x) => x.words);
    ['should / could', 'exclamatory', 'tense'].forEach((w) => expect(words).toContain(w));
  });

  test('a null paper gives an empty list', () => {
    expect(langGiveaways(null)).toEqual([]);
  });

  test('no flag has only oral as its `with`', () => {
    [urdu, english].forEach((p) => langGiveaways(p).forEach((x) => expect(x.with.some((s) => s !== 'oral')).toBe(true)));
  });

  // v34: an Urdu-medium Social Studies MCQ is not a language paper; the key-tell and known-pairs checks stay off it
  // (they re-asked social_studies.A.Q1 on the recorded SST fakes).
  test('the same items under a social_studies slot raise nothing', () => {
    const sst = JSON.parse(JSON.stringify(urdu).replace(/"urdu\./g, '"social_studies.'));
    expect(langGiveaways(urdu).length).toBeGreaterThan(0);
    expect(langGiveaways(sst)).toEqual([]);
  });
});
