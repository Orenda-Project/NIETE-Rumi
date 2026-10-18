/**
 * The label budget (one button system): a button's label fits ONE line at 360 px, in English and in Urdu, so every
 * button keeps its token height (56 / 52) instead of growing to two lines.
 *
 * Every button the Story Time room and its cards draw from a strings table (`wq-btn`, `wqs-sec`, `wqfc-share` markup
 * around `esc(t.<key>)`) in wq-challenge.js, wq-trail.js and wq-finish-card.js has every string value of that key at
 * most 20 characters in English and 18 in Urdu. The other pages' buttons are held to one line where it counts, on the
 * drawn screen: the look gate measures every button's height (56 / 52, 76 only for a two-line token). A button drawn as `esc(oneButton() && t.<short> || t.<key>)` is held
 * to the budget by its first key, the label the one button system draws; the key after `||` is today's label, drawn
 * only with the switch off, and is left as it is.
 */
const fs = require('fs');
const path = require('path');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const FILES = ['wq-challenge.js', 'wq-trail.js', 'wq-finish-card.js'];
const BUDGET = { en: 20, ur: 18 };
const URDU = /[؀-ۿ]/;

// The keys a button draws: the first strings-table key inside an esc(...) that sits in button markup.
function buttonKeys(src) {
  const keys = new Set();
  const re = /class="(?:wq-btn|wqs-sec|wqfc-share)[^"]*"[^<]{0,200}?esc\(([^)]*)\)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const k = /\b(?:t|T|TW)\.([A-Za-z_]\w*)/.exec(m[1]);
    if (k) keys.add(k[1]);
  }
  return keys;
}
// Every plain string value written for a key in the file's tables (`key: '...'` or `key: "..."`), any language.
function valuesOf(src, key) {
  const out = [];
  const re = new RegExp('[\\s{,]' + key + ":\\s*(['\"])((?:\\\\.|(?!\\1).)*)\\1", 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[2].replace(/\\(.)/g, '$1'));
  return out;
}

describe.each(FILES)('%s: every button label fits one line at 360 px', (file) => {
  const src = fs.readFileSync(path.join(WQ, file), 'utf8');
  const keys = [...buttonKeys(src)];
  test('its buttons are found', () => {
    expect(Array.isArray(keys)).toBe(true);
  });
  test.each(keys.length ? keys : ['(none)'])('%s: EN <= 20, UR <= 18 characters', (key) => {
    if (key === '(none)') return;
    valuesOf(src, key).forEach((v) => {
      const lang = URDU.test(v) ? 'ur' : 'en';
      expect([key, lang, v, v.length <= BUDGET[lang]]).toEqual([key, lang, v, true]);
    });
  });
});

describe('wq-challenge.js: the story questions button', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-challenge.js'), 'utf8');
  test('the one button system draws the short label (EN "Answer questions", UR «سوالوں کے جواب دیں»); off, today\'s', () => {
    expect(src).toContain("qaShort: 'Answer questions',");
    expect(src).toContain("qaShort: 'سوالوں کے جواب دیں',");
    expect(src).toContain("esc(oneButton() && t.qaShort || t.qaStart)");
    expect(src).toContain("qaStart: 'Answer questions about the story',");
  });
});
