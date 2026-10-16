/**
 * One Urdu word for the teacher on every child screen: «ٹیچر», never «استاد» («استاد» reads masculine; «ٹیچر» is what
 * children say). The teacher's own preview strip on the quiz page («استاد کے لیے») is teacher-facing and stays.
 * Each child string is asserted as shipped, file by file.
 */
const fs = require('fs');
const path = require('path');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', f), 'utf8');
const SITES = {
  'hub.js': [
    'آپ کے ٹیچر کی طرف سے',
    'ابھی ٹیچر کی طرف سے کوئی نیا کوئز نہیں۔ ایک ویڈیو دیکھیں اور اس کا کوئز کریں!',
    'مشق: ٹیچر کو آپ کا پہلا اسکور ہی نظر آتا ہے۔',
    'اپنے ٹیچر سے کوئز کا لنک لیں، یا گھر کے فون سے',
    'پہلے ٹیچر کا کوئی کوئز کھیلیں۔',
    'ابھی یہاں کوئی کوئز نہیں۔ ٹیچر سے کوئز کا لنک لیں۔',
    'مشق۔ ٹیچر کو پہلا اسکور ہی دکھے گا۔',
  ],
  'wq-lib.js': [
    'پہلے اپنے ٹیچر کا کوئی کوئز کھیلیں، پھر یہ ویڈیو یہاں کھلے گی۔',
    'پہلے ٹیچر کا کوئز کھیلیں، پھر یہ ویڈیو کھلے گی۔',
  ],
  'wq.js': [
    'انٹرنیٹ واپس آتے ہی آپ کا نتیجہ ٹیچر تک پہنچ جائے گا۔',
    'انٹرنیٹ آتے ہی نتیجہ ٹیچر کو مل جائے گا۔',
    'کھیلنے کے لیے جی ہاں دبائیں۔ ٹیچر خود دیکھ لیں گے کہ آپ کون ہیں۔',
  ],
};

describe.each(Object.keys(SITES))('%s', (f) => {
  test.each(SITES[f])('says «ٹیچر»: %s', (line) => {
    expect(src(f)).toContain(line);
  });
  test('no «استاد» left in a string a child sees', () => {
    const left = (src(f).match(/'[^'\n]*استاد[^'\n]*'/g) || []).filter((s) => s !== "'استاد کے لیے'");
    expect(left).toEqual([]);
  });
});

test('the closed-quiz page in Urdu: «اپنے ٹیچر سے نیا لنک لیں۔»', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'web-quiz.routes.js'), 'utf8');
  expect(routes).toContain("say: 'اپنے ٹیچر سے نیا لنک لیں۔'");
  expect(routes).not.toMatch(/'[^'\n]*استاد[^'\n]*'/);
});

