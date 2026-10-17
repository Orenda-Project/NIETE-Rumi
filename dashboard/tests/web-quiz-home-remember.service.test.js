/**
 * The first home after a child joins on their own (web_quiz_home_v3; the boot's `remember`, sent by the bot once):
 * the shipped wq-home.js run in a vm draws ONE line under the greeting, "Jugnu will remember you on this phone." with
 * ONE Undo (EN + UR), for 20 s, then the line goes; Undo asks the existing POST /api/wq/bind/undo with {from:'join'}
 * and opens the "who are you?" page the bot answers; no `remember` on the boot → the home's markup is byte-for-byte
 * today's (the golden was written from the file before this change). Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null,
  home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }], games: [{ kind: 'numbers' }], videos: null },
  head: { dots: 2, today: false, jar: { fresh: true } },
};
const REM = { ...HOME, remember: { s: 20 } };
const HOME_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.js');
const CSS_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.css');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'web-quiz-home-remember-golden.json'), 'utf8'));
const BANNED = /\b(test|tests|exam|assess\w*)\b|امتحان|ٹیسٹ/i;
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// A page whose root keeps the markup mount() wrote and answers the remember line's selectors from it.
function page({ fetchImpl = null } = {}) {
  const loc = { hash: '', pathname: '/h/x', search: '?from=join', replaced: [], replace(u) { this.replaced.push(u); }, assign(u) { this.replaced.push(u); } };
  const calls = [];
  let line = null;
  const mk = () => {
    const l = {};
    return {
      l, cls: [], disabled: false,
      classList: { add(c) { line && line.cls.push(c); }, remove() {} },
      addEventListener(n, fn) { (l[n] = l[n] || []).push(fn); },
      fire(n) { (l[n] || []).forEach((fn) => fn({ preventDefault() {} })); },
    };
  };
  const root = {
    innerHTML: '', setAttribute() {},
    querySelectorAll: () => [],
    appendChild() {}, removeChild(c) { if (c === line) { line = null; root.innerHTML = root.innerHTML.replace(/<p class="wq-remember"[\s\S]*?<\/p>/, ''); } },
    querySelector(sel) {
      if (sel === '[data-remember]') {
        if (!/data-remember[ >]/.test(root.innerHTML)) return null;
        if (!line) {
          line = mk(); line.parentNode = root;
          const undo = mk();
          line.undo = undo;
          line.querySelector = (s) => (s === '[data-remember-undo]' ? undo : null);
          line.classList = { add(c) { line.cls.push(c); }, remove() {} };
        }
        return line;
      }
      return null;
    },
  };
  const win = { addEventListener() {}, scrollTo() {} };
  const document = { querySelector: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {} }), head: { appendChild() {} } };
  const fetch = (url, init) => { calls.push([url, init]); return fetchImpl ? fetchImpl(url, init) : Promise.resolve({ json: () => Promise.resolve({ ok: true, next: 'https://portal.example.test/quiz/go/abc.DEF_123' }) }); };
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, navigator: {}, location: loc, fetch, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, Date, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp, Promise });
  return {
    H: win.WQHOME, root, loc, calls, line: () => line,
    mount(B, lang = 'en') { win.WQHOME.mount(root, B, { token: TOKEN, lang, ev() {} }); },
  };
}
const flush = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

describe('no `remember` on the boot: the home is today\'s, byte for byte', () => {
  test.each(['en', 'ur'])('%s: the home and a door equal the golden written before this change', (lang) => {
    const p = page();
    expect(p.H.html(HOME, { token: TOKEN, lang })).toBe(GOLDEN[lang]);
    expect(p.H.door(HOME, { token: TOKEN, lang }, 'stories')).toBe(GOLDEN[`${lang}_door_stories`]);
    expect(p.H.html(HOME, { token: TOKEN, lang })).not.toContain('data-remember');
  });
  test('a coach\'s preview never draws it', () => {
    const p = page();
    expect(p.H.html({ ...REM, practice: true, grade: 3 }, { token: TOKEN, lang: 'en' })).not.toContain('data-remember');
  });
});

describe('the first open after the join: one line + ONE Undo under the greeting', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test.each([
    ['en', 'Jugnu will remember you on this phone.', 'Undo'],
    ['ur', 'جگنو آپ کو اس فون پر یاد رکھے گا۔', 'یاد نہ رکھیں'],
  ])('%s: the words, after the greeting and before the Next tile; one primary still', (lang, words, undo) => {
    const p = page(); p.mount(REM, lang);
    const html = p.root.innerHTML;
    expect(visible(html)).toContain(words);
    expect((html.match(/data-remember-undo/g) || []).length).toBe(1);
    expect(html.indexOf('data-remember')).toBeGreaterThan(html.indexOf('wq-hhead'));
    expect(html.indexOf('data-remember')).toBeLessThan(html.indexOf('class="wq-next'));
    expect((html.match(/data-primary/g) || []).length).toBe(1);
    expect(html).toContain('>' + undo + '</button>');
    expect(visible(html)).not.toMatch(BANNED);
    expect(html).toMatch(/<p class="wq-remember"[^>]*role="status"/);
  });
  test('+20 s: the line fades and leaves; a later render of the same page does not draw it again', () => {
    const p = page(); p.mount(REM);
    expect(p.root.innerHTML).toContain('data-remember');
    jest.advanceTimersByTime(19000);
    expect(p.line()).not.toBeNull();
    expect(p.line().cls).not.toContain('wq-remgone');
    jest.advanceTimersByTime(1100);
    expect(p.line().cls).toContain('wq-remgone');
    jest.advanceTimersByTime(1000);
    expect(p.line()).toBeNull();
    expect(p.root.innerHTML).not.toContain('data-remember');
    // the sound toggle / a door and back re-draws the home: no line now
    p.mount(REM);
    expect(p.root.innerHTML).not.toContain('data-remember');
  });
  test('a re-draw inside the 20 s keeps the line (it is still the first open)', () => {
    const p = page(); p.mount(REM);
    jest.advanceTimersByTime(5000);
    p.mount(REM);
    expect(p.root.innerHTML).toContain('data-remember');
  });
});

describe('Undo', () => {
  test('one POST to the existing /api/wq/bind/undo with {from:"join"}, then the "who are you?" page', async () => {
    const p = page(); p.mount(REM, 'ur');
    p.line().undo.fire('click');
    await flush(); await flush();
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0][0]).toBe('/api/wq/bind/undo');
    expect(p.calls[0][1].method).toBe('POST');
    expect(JSON.parse(p.calls[0][1].body)).toEqual({ from: 'join', lang: 'ur' });
    expect(p.loc.replaced).toEqual(['https://portal.example.test/quiz/go/abc.DEF_123']);
    // a second tap while the first is on its way sends nothing more
    p.line() && p.line().undo.fire('click');
    await flush();
    expect(p.calls).toHaveLength(1);
  });
  test('erased but no page to go to (null next) → the line leaves; never a strange URL', async () => {
    const p = page({ fetchImpl: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, next: null }) }) });
    p.mount(REM);
    p.line().undo.fire('click');
    await flush(); await flush();
    expect(p.loc.replaced).toEqual([]);
    expect(p.line()).toBeNull();
    const q = page({ fetchImpl: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, next: 'javascript:alert(1)' }) }) });
    q.mount(REM);
    q.line().undo.fire('click');
    await flush(); await flush();
    expect(q.loc.replaced).toEqual([]);
  });
  test('a failed Undo keeps the line and lets the grown-up try again', async () => {
    const p = page({ fetchImpl: () => Promise.reject(new Error('offline')) });
    p.mount(REM);
    p.line().undo.fire('click');
    await flush(); await flush();
    expect(p.line()).not.toBeNull();
    expect(p.line().undo.disabled).toBe(false);
  });
});

describe('the look', () => {
  test('wq-home.css has the line, its small Undo (≥ 44 px tap) and the fade', () => {
    const css = fs.readFileSync(CSS_SRC, 'utf8');
    expect(css).toMatch(/\.wq-remember\{/);
    expect(Number((/\.wq-remundo\{[^}]*min-height:(\d+)px/.exec(css) || [])[1])).toBeGreaterThanOrEqual(44);
    expect(css).toMatch(/\.wq-remember\.wq-remgone\{[^}]*opacity:0/);
  });
});
