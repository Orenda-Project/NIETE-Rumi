/**
 * The adventure look's token layer is written twice: the first pages (role question, sheet, way back, join) inline the
 * copy in bot/shared/services/first-touch/adventure-look.js (TOKENS_CSS), and the child pages link
 * dashboard/public/wq/wq-adventure.css (its block between the tokens:begin / tokens:end markers). This holds the two
 * equal: every --land*, --brand*, --card, --ink*, --r-* declaration and the share / speaker button tokens, per selector,
 * with the same value. The only tokens allowed on one side alone are the one button system's --btn-* sizes.
 * wq-adventure.css arrives with its own change; until it is on the tree this suite is skipped and says so.
 */
const fs = require('fs');
const path = require('path');
const { TOKENS_CSS } = require('../../bot/shared/services/first-touch/adventure-look');

const SHEET = path.join(__dirname, '../public/wq/wq-adventure.css');
const HAS_SHEET = fs.existsSync(SHEET);
// the one button system's size tokens (web_quiz_one_button): the only names that may sit on one side alone
const ONE_SIDED_OK = /^--btn-/;
const COMPARED = /^--(land|brand|card|ink|r-)/;

/** css text → Map("selector|--name" → value) for the compared tokens (and every token on a share / speaker selector). */
function tokens(css) {
  const out = new Map();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, '$1');
  for (const [, sel, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = sel.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      const share = sels.some((x) => /wq-btn--(share|speaker)\b/.test(x));
      if (!COMPARED.test(name) && !share && !ONE_SIDED_OK.test(name)) continue;
      for (const one of sels) out.set(`${one}|${name}`, value.trim());
    }
  }
  return out;
}

/** → the differences between two token layers: [key, ours, theirs] (undefined = absent on that side). */
function diff(ours, theirs) {
  const a = tokens(ours);
  const b = tokens(theirs);
  const bad = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const name = k.split('|')[1];
    if (a.get(k) === b.get(k)) continue;
    if ((a.has(k) !== b.has(k)) && ONE_SIDED_OK.test(name)) continue;
    bad.push([k, a.get(k), b.get(k)]);
  }
  return bad;
}

const sheetTokens = () => {
  const css = fs.readFileSync(SHEET, 'utf8');
  const m = /\/\* tokens:begin \*\/([\s\S]*?)\/\* tokens:end \*\//.exec(css);
  return m ? m[1] : css;
};

if (!HAS_SHEET) console.log('adventure token equality: runs once wq-adventure.css is on the tree');
(HAS_SHEET ? describe : describe.skip)('the first pages\' token copy equals wq-adventure.css (runs once wq-adventure.css is on the tree)', () => {
  test('every --land*, --brand*, --card, --ink*, --r-* and share / speaker token: same selector, same value; one-sided only --btn-*', () => {
    const theirs = sheetTokens();
    expect(tokens(theirs).size).toBeGreaterThan(30);   // the parse found the layer (not an empty match)
    expect(diff(TOKENS_CSS, theirs)).toEqual([]);
    for (const k of ['html.wq-adv .wq-btn--share|--on', 'html.wq-adv .wq-btn--speaker|--on', 'html.wq-adv|--land-st', 'html.wq-adv|--r-btn']) {
      expect([k, tokens(TOKENS_CSS).has(k)]).toEqual([k, true]);
    }
  });
});

describe('the comparison itself (always runs)', () => {
  test('one changed value is a difference; a --btn-* size on one side is not; a missing --land token is', () => {
    expect(diff(TOKENS_CSS, TOKENS_CSS)).toEqual([]);
    const changed = TOKENS_CSS.replace('--land-st:#e97f2e', '--land-st:#e97f2f');
    expect(diff(TOKENS_CSS, changed)).toEqual([['html.wq-adv|--land-st', '#e97f2e', '#e97f2f']]);
    const share = TOKENS_CSS.replace('html.wq-adv .wq-btn--speaker{--fill:var(--card);--on:var(--land-edge)', 'html.wq-adv .wq-btn--speaker{--fill:var(--card);--on:var(--ink)');
    expect(diff(TOKENS_CSS, share)).toEqual([['html.wq-adv .wq-btn--speaker|--on', 'var(--land-edge)', 'var(--ink)']]);
    expect(diff(TOKENS_CSS, TOKENS_CSS.replace('--btn-h:56px;', ''))).toEqual([]);
    expect(diff(TOKENS_CSS, TOKENS_CSS.replace('--land-sp-on:#ffffff;', ''))).toEqual([['html.wq-adv|--land-sp-on', '#ffffff', undefined]]);
  });
});
