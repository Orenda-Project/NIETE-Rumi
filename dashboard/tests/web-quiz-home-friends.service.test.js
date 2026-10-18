/**
 * "A friend joined Jugnu from your card!" on the sharer's home (app_settings web_quiz_share_joined; the hub's
 * `friends_joined: {n, today}`, sent only when on and a friend joined): the shipped wq-home.js draws ONE line with the
 * "Guide" stamp under the greeting, once per new count on this phone (the count seen is kept per child), never on a
 * coach's preview. No `friends_joined`: the home is today's, byte for byte (the golden written before this change).
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
// the phone's own day: the count is today's (a day in Pakistan, the server's), so what was seen is kept per day
const pad = (n) => (n < 10 ? '0' : '') + n;
const DAY = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const SEEN = `wq_fj_${KID}_${DAY}`;
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null,
  home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }], games: [{ kind: 'numbers' }], videos: null },
  head: { dots: 2, today: false, jar: { fresh: true } },
};
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'web-quiz-home-remember-golden.json'), 'utf8'));
const BANNED = /\b(test|tests|exam|assess\w*)\b|امتحان|ٹیسٹ/i;
const WORDS = { en: ['A friend joined Jugnu from your card!', 'Guide'], ur: ['آپ کے کارڈ سے ایک دوست نے جگنو شروع کیا!', 'رہنما'] };
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function load(store = {}) {
  const win = { addEventListener() {}, scrollTo() {} };
  const document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {} }), head: { appendChild() {} } };
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-home.js'), 'utf8'),
    { window: win, document, navigator: {}, location: { hash: '', pathname: '/h/x', search: '' }, fetch: () => Promise.resolve({}), localStorage: ls, setTimeout, clearTimeout, Date, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp, Promise });
  return { H: win.WQHOME, store };
}

describe('no `friends_joined`: today\'s home, byte for byte', () => {
  test.each(['en', 'ur'])('%s', (lang) => {
    const { H } = load();
    // the shared golden was recorded with the bare first name; this file's child is its Testwala
    expect(H.html(HOME, { token: TOKEN, lang })).toBe(GOLDEN[lang].split('Zara').join('Zara Testwala'));
  });
});

describe('a friend joined from this child\'s card', () => {
  test.each(['en', 'ur'])('%s: ONE line with the stamp, after the greeting and before the Next tile; one primary still', (lang) => {
    const { H, store } = load();
    const html = H.html({ ...HOME, friends_joined: { n: 1, today: true } }, { token: TOKEN, lang });
    expect(visible(html)).toContain(WORDS[lang][0]);
    expect(visible(html)).toContain(WORDS[lang][1]);
    expect((html.match(/data-friends/g) || []).length).toBe(1);
    expect(html.indexOf('data-friends')).toBeGreaterThan(html.indexOf('wq-hhead'));
    expect(html.indexOf('data-friends')).toBeLessThan(html.indexOf('class="wq-next'));
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(html).toMatch(/<p class="wq-friend"[^>]*role="status"/);
    expect(visible(html)).not.toMatch(BANNED);
    // seen on this phone, for this child
    expect(store[SEEN]).toBe('1');
    // a later render of the same page keeps it
    expect(H.html({ ...HOME, friends_joined: { n: 1, today: true } }, { token: TOKEN, lang })).toContain('data-friends');
  });
  test('seen already on this phone: not again; a new friend (n goes up): again', () => {
    expect(load({ [SEEN]: '1' }).H.html({ ...HOME, friends_joined: { n: 1, today: true } }, { token: TOKEN, lang: 'en' })).not.toContain('data-friends');
    expect(load({ [SEEN]: '1' }).H.html({ ...HOME, friends_joined: { n: 2, today: true } }, { token: TOKEN, lang: 'en' })).toContain('data-friends');
  });
  test('a new day: the first friend of the day shows, whatever was seen yesterday', () => {
    const { H, store } = load({ [`wq_fj_${KID}_2026-01-01`]: '3' });
    expect(H.html({ ...HOME, friends_joined: { n: 1, today: true } }, { token: TOKEN, lang: 'en' })).toContain('data-friends');
    expect(store[SEEN]).toBe('1');
  });
  test('a coach\'s preview, a zero or a junk count: nothing', () => {
    for (const B of [{ ...HOME, practice: true, grade: 3, friends_joined: { n: 1 } }, { ...HOME, friends_joined: { n: 0 } }, { ...HOME, friends_joined: { n: 'x' } }, { ...HOME, friends_joined: 1 }]) {
      expect(load().H.html(B, { token: TOKEN, lang: 'en' })).not.toContain('data-friends');
    }
  });
  test('the line\'s style is in the home\'s own sheet: off the screen edge, and the stamp sits beside the words', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-home.css'), 'utf8');
    expect(css).toMatch(/\.wq-friend\{[^}]*display:flex[^}]*\}/);
  });
});
