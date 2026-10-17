/**
 * Jugnu's passage pool, word by word: every passage the page can serve splits into words that the live read can keep.
 *   - the live read (public/wq/wq-read-live.js) cleans each whitespace token with clean() (diacritics and punctuation
 *     off) and lights one span per cleaned word; a token that cleans to '' (a dash or a full stop standing alone, say)
 *     would leave the printed words and the lit words out of step
 *   - so no served passage may hold such a token: every passage the bank serves (item-bank.js listPassages(): the files in
 *     bot/shared/data/child-test/passages/, a Set A pointer file resolved to its v3 story), its `tokens` list when it has
 *     one, and the passage texts in item-bank.v1.json / item-bank.v3.json (0 today)
 * No product change: this guards the pool so it stays that way.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public', 'wq');
const LIVE_SRC = fs.readFileSync(path.join(PUB, 'wq-read-live.js'), 'utf8');
const DATA = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test');
const Bank = require('../../bot/shared/services/child-test/item-bank');

function live() {
  const window = {};
  const ctx = { window, console, Date, Math, JSON, String, Number, Object, Array, RegExp, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(LIVE_SRC, ctx);
  return window.WQLive;
}

// every passage text the page can serve: [where, text | tokens[]]
function servedTexts() {
  const out = [];
  for (const p of Bank.listPassages()) {
    out.push([`passage ${p.passage_id}`, p.text]);
    if (Array.isArray(p.tokens)) out.push([`passage ${p.passage_id} tokens`, p.tokens]);
  }
  for (const bank of ['item-bank.v1.json', 'item-bank.v3.json']) {
    const walk = (o, at) => {
      if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${at}[${i}]`));
      else if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'story' && v && typeof v.text === 'string') out.push([`${bank} ${at}.story`, v.text]);
          walk(v, `${at}.${k}`);
        }
      }
    };
    walk(JSON.parse(fs.readFileSync(path.join(DATA, bank), 'utf8')), '');
  }
  return out;
}

// a text is split on whitespace (as the page's words() does); a tokens list is taken as given (as tracker() does)
const emptied = (clean, text) => (Array.isArray(text) ? text.filter((t) => String(t).trim()) : text.match(/\S+/g) || []).filter((t) => clean(t) === '');

describe('passage pool: no word the live read would drop', () => {
  const { clean } = live();
  const texts = servedTexts();

  test('the pool is read: every passage file, resolved, and the 12 item-bank passage texts', () => {
    const files = fs.readdirSync(path.join(DATA, 'passages')).filter((x) => x.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(Bank.listPassages().length).toBe(files.length);
    expect(texts.filter(([at]) => at.startsWith('item-bank')).length).toBe(12);
    for (const [at, text] of texts) expect([at, Array.isArray(text) ? text.length > 0 : typeof text === 'string' && text.trim().length > 0]).toEqual([at, true]);
  });

  test('the check bites: a token clean() empties is found', () => {
    expect(emptied(clean, 'The cat ran — home .')).toEqual(['—', '.']);
    expect(emptied(clean, 'بلی گھر گئی ۔ پھر')).toEqual(['۔']);
    expect(emptied(clean, 'بلی گھر گئی۔ پھر')).toEqual([]);
    expect(emptied(clean, ['The', 'cat', '—', 'ran', ' '])).toEqual(['—']);
  });

  test.each(texts.map(([at, text]) => [at, text]))('%s: no token clean() empties', (at, text) => {
    expect(emptied(clean, text)).toEqual([]);
  });
});
