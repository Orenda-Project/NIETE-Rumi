/**
 * Web quiz page copy (public/wq/wq.js, the T table): the page wears whichever brand the
 * deployment configures, so a button's colour is the brand's. Copy that names a colour
 * ("tap the green button") is wrong under any brand whose button is not that colour.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  var T = {');
const END = SRC.indexOf('\n  }[LANG];', START);
const COPY = SRC.slice(START, END);

test('the copy block is where this test cuts it from', () => {
  expect(START).toBeGreaterThan(0);
  expect(END).toBeGreaterThan(START);
  expect(COPY).toContain('fbSub');
});

test.each([
  ['English colour words', /\b(green|orange|coral|navy|blue|red|yellow) (button|key)\b/i],
  ['Urdu colour words', /(ہرا|ہرے|سبز|نیلا|لال|سرخ|نارنجی) بٹن/],
])('no copy names a button by its colour (%s)', (_, re) => {
  expect(COPY.match(re)).toBeNull();
});
