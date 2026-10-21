/**
 * The Urdu words a child reads stay Urdu: no new «شیئر» (share → «بھیجیں»), no new «ٹیپ» (tap → «دبائیں»), and no
 * bare «نہیں کھیلا» aimed at the reader (it reads masculine; «آپ نے … نہیں کھیلا» and «کسی نے نہیں کھیلا» are the
 * same for every child, so they pass).
 *
 * Every quoted string with Urdu letters in dashboard/public/wq/*.js is read. The strings that still say these words
 * today are listed below, each with how many times it appears. The list only shrinks:
 *   - a new string with one of the words fails (write it in Urdu, or have it read and listed here);
 *   - a listed string that is gone fails too, so its line leaves the list the day its switch or its fix lands.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'wq');
const RULES = { share: /شیئر/, tap: /ٹیپ/, bare: /نہیں کھیلا/ };
// «… نے … نہیں کھیلا» inside one clause is neutral; what is left after removing it is checked for a bare form
const neutral = (s) => s.replace(/نے[^،۔؟!:]*?نہیں کھیلا/g, '');

// file → the string as written in the source → times it appears. Today's words, read on 18 Oct.
const ALLOWED = {
  'hub.js': {
    'اپنے نام پر ٹیپ کریں۔': 1,
    'صفحہ ابھی کھل رہا ہے… دوبارہ کوشش کے لیے یہاں ٹیپ کریں۔': 1,
  },
  'wq-finish-card.js': {
    'شیئر کریں': 1, // the end card's no-class Share; «دوستوں کو بھیجیں» with web_quiz_ur_share_copy
  },
  'wq.js': {
    'اپنے نام پر ٹیپ کریں۔': 1,
    'رنگ یا تصویر پر ٹیپ کریں': 1,
    'قدموں کو صحیح ترتیب سے ٹیپ کریں۔': 1,
    'ایک پر ٹیپ کریں، پھر اس کے جوڑے پر۔': 1,
    'تصویر میں صحیح حصے پر ٹیپ کریں۔': 1,
    'شیئر کریں': 1, // the quiz finish no-class Share; «دوستوں کو بھیجیں» with web_quiz_ur_share_copy
    ' کی لیگ ٹیبل۔ ابھی نہیں کھیلا؟ وہی لنک ابھی کھلا ہے:': 1, // tableLine; the reader is named with web_quiz_ur_share_copy
    ' ستارے لیے۔ مجھ سے آگے نکل کر دکھائیں! 🏆 کھیلنے کے لیے لنک پر ٹیپ کریں:': 1, // chalLine; «دبائیں» with ur_share or ur_polish
    ' ستارہ لیا۔ مجھ سے آگے نکل کر دکھائیں! 🏆 کھیلنے کے لیے لنک پر ٹیپ کریں:': 1, // chalLine_one (one star, web_quiz_share_copy_one); the same
    '\\u2069 کوئز کھیلا۔ اب آپ کی باری! کھیلنے کے لیے لنک پر ٹیپ کریں:': 1, // chalPlayed; the same
    'ہر درست جواب پر ٹیپ کریں، پھر جانچیں۔': 1,
    'یا اپنے نام پر ٹیپ کریں': 1,
    'اپنی کلاس پر ٹیپ کریں۔': 1,
    'جو بچے آپ کی کلاس لسٹ میں نہیں، وہ اوپر ہیں۔ رول نمبر دینے کے لیے نام پر ٹیپ کریں۔': 1, // teacher's who-played sheet
    'ابھی نہیں کھیلا (': 1, // teacher's who-played sheet: a count of children, not said to a child
  },
};

function flagged(src) {
  const out = {};
  for (const m of src.matchAll(/'([^'\n]*[؀-ۿ][^'\n]*)'|"([^"\n]*[؀-ۿ][^"\n]*)"/g)) {
    const s = m[1] !== undefined ? m[1] : m[2];
    if (RULES.share.test(s) || RULES.tap.test(s) || RULES.bare.test(neutral(s))) out[s] = (out[s] || 0) + 1;
  }
  return out;
}
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();

describe('Urdu loans and bare forms on the child\'s pages', () => {
  test.each(files)('%s: no new one', (f) => {
    const got = flagged(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const extra = Object.entries(got).filter(([s, n]) => n > ((ALLOWED[f] || {})[s] || 0)).map(([s]) => s);
    expect(extra).toEqual([]);
  });
  test.each(files)('%s: no listed one is gone (take it off the list)', (f) => {
    const got = flagged(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const gone = Object.entries(ALLOWED[f] || {}).filter(([s, n]) => (got[s] || 0) < n).map(([s]) => s);
    expect(gone).toEqual([]);
  });
  test('every listed file is still there', () => {
    expect(Object.keys(ALLOWED).filter((f) => !files.includes(f))).toEqual([]);
  });
  test('the rules: a loan or a bare form is caught, the neutral forms pass', () => {
    const one = (s) => Object.keys(flagged(`x = '${s}';`));
    expect(one('شیئر کریں')).toHaveLength(1);
    expect(one('لنک پر ٹیپ کریں')).toHaveLength(1);
    expect(one('ابھی نہیں کھیلا؟')).toHaveLength(1);
    expect(one('آپ نے ابھی تک نہیں کھیلا؟ یہ لنک ابھی بھی کھلا ہے')).toHaveLength(0);
    expect(one('اس ہفتے کسی نے نہیں کھیلا۔ سب سے پہلے کھیلیں!')).toHaveLength(0);
    expect(one('دوستوں کو بھیجیں')).toHaveLength(0);
    expect(one('Share')).toHaveLength(0);
  });
});
