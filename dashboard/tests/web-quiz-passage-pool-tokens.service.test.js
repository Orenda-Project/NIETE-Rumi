/**
 * Jugnu's passage pool, word by word: every passage the page can serve splits into words that the live read can keep.
 *   - the page splits a passage with liveWords() (public/wq/wq-challenge.js: the story's `tokens` list when it has one,
 *     else its text split on whitespace) and hands that to WQLive.tracker() (public/wq/wq-read-live.js), whose
 *     `.words` are the words the child sees lit; each is matched through clean() (diacritics and punctuation off), so a
 *     word that cleans to '' (a dash or a full stop standing alone, say) would leave the printed words and the lit
 *     words out of step
 *   - so no served passage may hold such a word: every passage the bank serves (item-bank.js listPassages(): the files in
 *     bot/shared/data/child-test/passages/, a Set A pointer file resolved to its v3 story), split as the page splits it
 *     (with its `tokens` list, and by its text alone), and the passage texts in item-bank.v1.json / item-bank.v3.json
 *   - the split is the page's own: liveWords() is cut out of wq-challenge.js and run, never copied here
 * No product change: this guards the pool so it stays that way.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public', 'wq');
const LIVE_SRC = fs.readFileSync(path.join(PUB, 'wq-read-live.js'), 'utf8');
const SRC = fs.readFileSync(path.join(PUB, 'wq-challenge.js'), 'utf8');
const DATA = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test');
const Bank = require('../../bot/shared/services/child-test/item-bank');

function live() {
  const window = {};
  const ctx = { window, console, Date, Math, JSON, String, Number, Object, Array, RegExp, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(LIVE_SRC, ctx);
  return window.WQLive;
}

// the page's own liveWords(st), cut out of wq-challenge.js (it lives inside the page's closure) and run as it is
function pageLiveWords() {
  const head = 'function liveWords(st) {';
  const at = SRC.indexOf(head);
  if (at < 0 || SRC.indexOf(head, at + 1) >= 0) throw new Error('wq-challenge.js: expected exactly one liveWords(st)');
  let depth = 0; let end = -1;
  for (let i = at + head.length - 1; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(at, end)}\nthis.liveWords = liveWords;`, ctx);
  return ctx.liveWords;
}

// every passage the page can serve, as the story object the page gets: [where, { text, tokens }]
function servedStories() {
  const out = [];
  for (const p of Bank.listPassages()) {
    out.push([`passage ${p.passage_id}`, { text: p.text, tokens: p.tokens }]);
    if (Array.isArray(p.tokens) && p.tokens.length) out.push([`passage ${p.passage_id} text`, { text: p.text }]);
  }
  for (const bank of ['item-bank.v1.json', 'item-bank.v3.json']) {
    const walk = (o, at) => {
      if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${at}[${i}]`));
      else if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'story' && v && typeof v.text === 'string') out.push([`${bank} ${at}.story`, { text: v.text, tokens: v.tokens }]);
          walk(v, `${at}.${k}`);
        }
      }
    };
    walk(JSON.parse(fs.readFileSync(path.join(DATA, bank), 'utf8')), '');
  }
  return out;
}

describe('passage pool: no word the live read would drop', () => {
  const WQLive = live();
  const { clean } = WQLive;
  const liveWords = pageLiveWords();
  // the words the live read lights for a story, as the page builds them, and those clean() empties
  const words = (st) => WQLive.tracker(liveWords(st)).words;
  const emptied = (st) => words(st).filter((t) => clean(t) === '');
  const stories = servedStories();

  test('the pool is read: every passage file, resolved, and the 12 item-bank passage texts', () => {
    const files = fs.readdirSync(path.join(DATA, 'passages')).filter((x) => x.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(Bank.listPassages().length).toBe(files.length);
    expect(stories.filter(([at]) => at.startsWith('item-bank')).length).toBe(12);
    for (const [at, st] of stories) expect([at, words(st).length > 0]).toEqual([at, true]);
  });

  test('the check bites: the split of the page keeps a word clean() empties, and it is found', () => {
    expect(words({ text: 'The cat ran — home .' })).toEqual(['The', 'cat', 'ran', '—', 'home', '.']);
    expect(emptied({ text: 'The cat ran — home .' })).toEqual(['—', '.']);
    expect(emptied({ text: 'بلی گھر گئی ۔ پھر' })).toEqual(['۔']);
    expect(emptied({ text: 'بلی گھر گئی۔ پھر' })).toEqual([]);
    expect(emptied({ text: 'x', tokens: ['The', 'cat', '—', 'ran', ' '] })).toEqual(['—']);
  });

  test.each(stories)('%s: no word clean() empties', (at, st) => {
    expect(emptied(st)).toEqual([]);
  });
});
