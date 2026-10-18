/**
 * Every child list has three states, never a wrong one (app_settings web_quiz_list_states; the boot's `list_states: 1`):
 * loading (a skeleton of the list), empty (only after the rows came back with none) and failed (a retry). The Games
 * door paints its rows once: they are asked for when the door screens load (WQDOORS.warm), so a tap finds them; a tap
 * before they arrive holds a skeleton, then draws the whole list in one paint. The Stories door's "new stories are on
 * the way" note stays hidden while the shelf is loading. The quiz Home button's style is only on a link or a button,
 * so a whole screen is never a button (one tap lights only the card). Switch off: every door screen is byte-identical
 * to today's (golden recorded on the base). Invented rows only.
 */
const fs = require('fs');
const path = require('path');
const { load, bootOf, screensFor, TOKEN, GAMES } = require('./wq-list-states-screens');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const GOLDEN = require('./fixtures/list-states-off-golden.json');
const count = (html, rx) => (html.match(rx) || []).length;
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const ON = { list_states: 1 };

describe('GOLDEN: switch off, every door screen is today\'s, byte for byte', () => {
  test.each(['en', 'ur'])('%s', (lang) => {
    expect(screensFor(lang, {})).toEqual(GOLDEN[lang]);
    expect(screensFor(lang, { list_states: 0 })).toEqual(GOLDEN[lang]);
  });
});

describe('switch on: loading is a skeleton, empty only from rows that came back empty, failed is a retry', () => {
  test.each(['en', 'ur'])('%s: Games before its rows: a skeleton (one primary), no placeholder row, no empty note', (lang) => {
    const W = load();
    const s = screensFor(lang, ON, W);
    const t = W.WQDOORS.COPY[lang];
    expect(s.gamesBoot).toMatch(/aria-busy="true"/);
    expect(visible(s.gamesBoot)).not.toContain(t.g1); // not the generic "Numbers with Jugnu" stand-in
    expect(visible(s.gamesBoot)).not.toContain(t.gamesNone);
    expect(count(s.gamesBoot, /data-primary/g)).toBe(1);
    expect(count(s.gamesBoot, /data-home/g)).toBe(1);
  });
  // the skeleton is the list's own shape: what the boot already knows is real, only the rows still on their way are grey,
  // so the primary does not move when they arrive
  const primaryRow = (h) => (h.match(/<(a|button) class="wq-row wq-drow" data-primary[^>]*>/) || [''])[0];
  const before = (h, a, b) => h.indexOf(a) >= 0 && h.indexOf(b) > h.indexOf(a);
  test.each(['en', 'ur'])('%s: Games before its rows: the teacher\'s quiz is a real row and the primary, the same one the rows keep', (lang) => {
    const W = load();
    const t = W.WQDOORS.COPY[lang];
    const s = screensFor(lang, ON, W);
    expect(primaryRow(s.gamesBoot)).toMatch(/MATH01/);
    expect(primaryRow(s.gamesBoot)).toBe(primaryRow(s.gamesRows));
    expect(visible(s.gamesBoot)).toContain('Fractions');
    expect(count(s.gamesBoot, /data-primary/g)).toBe(1);
    // the numbers' heading is known (the boot has a numbers stop): heading, then its grey rows, in the rows' order
    expect(before(s.gamesBoot, 'Fractions', t.numbers)).toBe(true);
    expect(before(s.gamesBoot, t.numbers, 'wq-dskel')).toBe(true);
  });
  test.each(['en', 'ur'])('%s: Games before its rows with no teacher\'s quiz: the grey rows under the numbers heading are the primary', (lang) => {
    const W = load();
    const t = W.WQDOORS.COPY[lang];
    const B = { ...bootOf(lang, ON), doors: { stories: [{ kind: 'shelf' }], games: [{ kind: 'numbers' }], videos: null } };
    const h = W.WQDOORS.html(B, { token: TOKEN, lang }, 'games', null);
    expect(count(h, /data-primary/g)).toBe(1);
    expect(h).toMatch(/<\/h3><div class="wq-dskel wq-dskel-in" data-primary aria-busy="true">/);
    expect(before(h, t.numbers, 'data-primary')).toBe(true);
    expect(visible(h)).not.toContain(t.g1);
  });
  test.each(['en', 'ur'])('%s: Games before its rows with nothing known: the plain skeleton, the primary', (lang) => {
    const W = load();
    const B = { ...bootOf(lang, ON), doors: { stories: [], games: [], videos: null } };
    const h = W.WQDOORS.html(B, { token: TOKEN, lang }, 'games', null);
    expect(count(h, /data-primary/g)).toBe(1);
    expect(h).toMatch(/<div class="wq-dskel" data-primary aria-busy="true">/);
  });
  test.each(['en', 'ur'])('%s: Games rows that failed: a retry (the primary), never the "read a story" empty note', (lang) => {
    const W = load();
    const t = W.WQDOORS.COPY[lang];
    const h = W.WQDOORS.html(bootOf(lang, ON), { token: TOKEN, lang }, 'games', { games: [], err: 1 });
    expect(h).toMatch(/data-primary data-tap="retry"/);
    expect(visible(h)).toContain(t.oops);
    expect(visible(h)).not.toContain(t.gamesNone);
    expect(count(h, /data-primary/g)).toBe(1);
  });
  test.each(['en', 'ur'])('%s: Games rows that came back empty: the true empty note', (lang) => {
    const W = load();
    expect(visible(screensFor(lang, ON, W).gamesNone)).toContain(W.WQDOORS.COPY[lang].gamesNone);
  });
  test.each(['en', 'ur'])('%s: Stories while the shelf loads: the slot holds a skeleton, the "on the way" note is hidden', (lang) => {
    const s = screensFor(lang, ON);
    // the skeleton holds the screen's one primary while it waits (the hidden note's button is not a second one)
    expect(s.storiesBoot).toMatch(/data-stories-shelf="1" data-host="doors"><div class="wq-dskel wq-dskel-bk" data-primary aria-busy="true"/);
    expect(count(s.storiesBoot, /<i class="wq-skrow"><\/i>/g)).toBe(4); // book-shaped: the shelf's two-by-two covers
    expect(s.storiesBoot.split('data-shelf-fallback')[1]).not.toMatch(/data-primary/);
    expect(s.storiesBoot).toMatch(/<div data-shelf-fallback="1" hidden>/);
    expect(count(s.storiesBoot, /data-primary/g)).toBe(1);
    // with no shelf at all (the boot says so) the note is the true empty, shown
    expect(s.storiesNone).not.toMatch(/ hidden>/);
  });
  test.each(['en', 'ur'])('%s: Videos lists before their data: a skeleton, not "Opening the video"; a chapter list that failed: a retry', (lang) => {
    const W = load();
    const t = W.WQDOORS.COPY[lang];
    const s = screensFor(lang, ON, W);
    for (const h of [s.videosWait, s.chaptersWait]) {
      expect(h).toMatch(/aria-busy="true"/);
      expect(visible(h)).not.toContain(t.opening);
      expect(count(h, /data-primary/g)).toBe(1);
    }
    const err = W.WQDOORS.html(bootOf(lang, ON), { token: TOKEN, lang }, 'videos', { subject: 'Science', lib: { err: true } });
    expect(err).toMatch(/data-primary data-tap="retry"/);
    expect(visible(err)).not.toContain(t.none);
  });
});

// A small fake DOM for the live paths (no jsdom in this package), as in web-quiz-doors-v3.service.test.js.
function el(extra = {}) {
  return {
    attrs: {}, hidden: false, listeners: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || { preventDefault() {}, stopPropagation() {} })); },
    querySelector: () => null, ...extra,
  };
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
function live({ win = {}, fetchImpl, scripts = {} } = {}) {
  const head = [];
  const observers = [];
  const MutationObserver = function (cb) { this.observe = () => observers.push(cb); };
  const fetch = jest.fn(fetchImpl || (() => new Promise(() => {})));
  const document = {
    getElementById: () => null,
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : Object.keys(scripts).find((k) => sel.indexOf(k) >= 0) ? scripts[Object.keys(scripts).find((k) => sel.indexOf(k) >= 0)] : null),
    createElement: (tag) => el({ tag }),
    head: { appendChild: (x) => head.push(x) },
  };
  const location = { hash: '#games', pathname: `/h/${TOKEN}`, search: '' };
  const W = load({ win: { scrollTo() {}, addEventListener() {}, ...win }, globals: { fetch, document, location, MutationObserver, setImmediate } });
  return { W, fetch, head, observers };
}
// A root that keeps every paint, the taps of its latest one wired as fake elements.
function paintRoot() {
  const paints = [];
  const taps = { retry: el({ attrs: { 'data-tap': 'retry' } }) };
  taps.retry.getAttribute = (k) => (k === 'data-tap' ? 'retry' : null);
  return {
    paints, taps, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    get innerHTML() { return paints[paints.length - 1] || ''; }, set innerHTML(v) { paints.push(v); },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-tap]' && /data-tap="retry"/.test(paints[paints.length - 1] || '') ? [taps.retry] : []),
  };
}
const OK = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const B_ON = bootOf('en', ON);
const C = { token: TOKEN, lang: 'en', ev() {} };
const SECTIONS = ['From your teacher', 'Fractions', 'Number games', 'Number warm-up', 'Which is bigger?', 'A story with Jugnu', 'The red kite'];

describe('the Games door paints its list once', () => {
  test('rows asked for when the door screens load (warm): the first paint on a tap already holds every section, one paint', async () => {
    const { W, fetch } = live({ fetchImpl: OK(GAMES) });
    W.WQDOORS.warm(B_ON, C);
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/wq\/doors\/h\/[^?]+\?kid=[^&]+&d=games&l=en$/), expect.anything());
    await flush();
    const r = paintRoot();
    W.WQDOORS.mount(r, B_ON, C, 'games');
    await flush();
    expect(r.paints).toHaveLength(1);
    for (const s of SECTIONS) expect(visible(r.paints[0]).replace(/&#39;/g, "'")).toContain(s);
    expect(fetch.mock.calls.filter((c) => /d=games/.test(c[0]))).toHaveLength(1);
  });
  test('a tap before the rows arrive: a skeleton (no row, no empty note), then the whole list in one paint; the in-flight ask is shared', async () => {
    let answer;
    const { W, fetch } = live({ fetchImpl: (u) => (/d=games/.test(u) ? new Promise((res) => { answer = res; }) : new Promise(() => {})) });
    W.WQDOORS.warm(B_ON, C);
    const r = paintRoot();
    W.WQDOORS.mount(r, B_ON, C, 'games');
    expect(r.paints).toHaveLength(1);
    expect(r.paints[0]).toMatch(/aria-busy="true"/);
    expect(r.paints[0]).not.toMatch(/Numbers with Jugnu|Read a story with Jugnu/);
    answer({ ok: true, status: 200, json: () => Promise.resolve(GAMES) });
    await flush();
    expect(r.paints).toHaveLength(2);
    for (const s of SECTIONS) expect(visible(r.paints[1])).toContain(s);
    expect(fetch.mock.calls.filter((c) => /d=games/.test(c[0]))).toHaveLength(1);
  });
  test('the rows fail: a retry (never the empty note); the retry asks again and paints the list', async () => {
    let n = 0;
    const { W, fetch } = live({ fetchImpl: (u) => (/d=games/.test(u) ? (n += 1) === 1 ? Promise.reject(new Error('offline')) : OK(GAMES)() : new Promise(() => {})) });
    const r = paintRoot();
    W.WQDOORS.mount(r, B_ON, C, 'games');
    await flush();
    const last = r.paints[r.paints.length - 1];
    expect(last).toMatch(/data-primary data-tap="retry"/);
    expect(last).not.toContain('Read a story with Jugnu');
    r.taps.retry.fire('click');
    await flush();
    expect(fetch.mock.calls.filter((c) => /d=games/.test(c[0]))).toHaveLength(2);
    for (const s of SECTIONS) expect(visible(r.paints[r.paints.length - 1])).toContain(s);
  });
  test('a server that answers its own failure ({games: [], err: 1}): the retry, not the empty note', async () => {
    const { W } = live({ fetchImpl: OK({ games: [], err: 1 }) });
    const r = paintRoot();
    W.WQDOORS.mount(r, B_ON, C, 'games');
    await flush();
    expect(r.paints[r.paints.length - 1]).toMatch(/data-tap="retry"/);
  });
  test('switch off: warm asks for nothing; the tap paints today\'s placeholder first (golden behaviour kept)', async () => {
    const { W, fetch } = live({ fetchImpl: OK(GAMES) });
    const B = bootOf('en', {});
    W.WQDOORS.warm(B, C);
    expect(fetch).not.toHaveBeenCalled();
    const r = paintRoot();
    W.WQDOORS.mount(r, B, C, 'games');
    expect(r.paints[0]).toContain('Numbers with Jugnu');
  });
  test('a teacher\'s class preview: warm asks for nothing', () => {
    const { W, fetch } = live({ fetchImpl: OK(GAMES) });
    W.WQDOORS.warm({ ...B_ON, practice: 1, kid: null }, C);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the Stories door never says "no stories" while the shelf loads', () => {
  test('the fallback note stays hidden until the shelf has answered; shown only when it answered with none', () => {
    const shelf = jest.fn();
    const { W, observers } = live({ win: { WQSTORIES: { shelf } } });
    const sh = el(); const btn = el(); btn.setAttribute('data-primary', ''); const fb = el({ querySelector: (q) => (q === '.wq-go' ? btn : null) });
    fb.hidden = true;
    const root = { innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; }, querySelector: (q) => ({ '[data-stories-shelf]': sh, '[data-shelf-fallback]': fb })[q] || null, querySelectorAll: () => [] };
    W.WQDOORS.mount(root, { ...B_ON, doors: { stories: [{ kind: 'shelf' }], games: [], videos: null } }, C, 'stories');
    expect(shelf).toHaveBeenCalled();
    expect(fb.hidden).toBe(true); // not filled yet
    expect(root.attrs['data-fetch']).toBe('pending'); // the test marker: no empty stamp while pending
    expect(root.attrs['data-empty-at']).toBeUndefined();
    sh.setAttribute('data-filled', '1');
    sh.querySelector = (q) => (q === '[aria-busy="true"]' ? el() : null); // the reader's own skeleton
    observers.forEach((cb) => cb());
    expect(fb.hidden).toBe(true);
    sh.querySelector = (q) => (q === '[data-primary]' ? el() : null); // books
    observers.forEach((cb) => cb());
    expect(fb.hidden).toBe(true);
    sh.querySelector = () => null; sh.hidden = true; // the server has no shelf: the true empty
    observers.forEach((cb) => cb());
    expect(fb.hidden).toBe(false);
    expect(btn.getAttribute('data-primary')).toBe('');
    expect(root.attrs['data-fetch']).toBe('done');
    expect(root.attrs['data-empty-at']).toMatch(/^\d+$/);
  });
  test('the reader already asked for by the home (its load callback would be dropped): the door listens to that script and fills its slot', () => {
    const script = el();
    const { W } = live({ scripts: { 'wq-stories.js': script } });
    const sh = el();
    const root = { innerHTML: '', attrs: {}, setAttribute() {}, querySelector: (q) => (q === '[data-stories-shelf]' ? sh : null), querySelectorAll: () => [] };
    W.WQHOME.loadOnce('wq-stories'); // the home's own ask, no callback
    W.WQDOORS.mount(root, { ...B_ON, doors: { stories: [{ kind: 'shelf' }], games: [], videos: null } }, C, 'stories');
    const shelf = jest.fn();
    W.WQSTORIES = { shelf };
    script.fire('load');
    expect(shelf).toHaveBeenCalledWith(sh, expect.anything(), expect.objectContaining({ token: TOKEN }));
  });
  // the door drawn twice before the reader script arrives (its rows came back and redrew it): the shelf is asked once
  const storiesRoot = (cur) => ({ innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; }, querySelector: (q) => (q === '[data-stories-shelf]' ? cur() : null), querySelectorAll: () => [] });
  const STORIES_B = { ...B_ON, doors: { stories: [{ kind: 'shelf' }], games: [], videos: null } };
  test('the reader arrives after the rows redrew the door: one shelf read, not one per draw', () => {
    const script = el();
    const { W } = live({ scripts: { 'wq-stories.js': script } });
    const sh1 = el(); const sh2 = el(); sh2.setAttribute('data-host', 'doors');
    let cur = sh1;
    const root = storiesRoot(() => cur);
    W.WQHOME.loadOnce('wq-stories');
    W.WQDOORS.mount(root, STORIES_B, C, 'stories');
    cur = sh2; // the rows came back: the door drew again, its own slot replacing the first
    W.WQDOORS.mount(root, STORIES_B, C, 'stories');
    const shelf = jest.fn();
    W.WQSTORIES = { shelf };
    script.fire('load');
    expect(shelf).toHaveBeenCalledTimes(1);
    expect(shelf).toHaveBeenCalledWith(sh2, expect.anything(), expect.anything());
  });
  test('the reader script fails to load: a retry in the slot, and the door root says failed (not pending)', () => {
    const script = el();
    const { W } = live({ scripts: { 'wq-stories.js': script } });
    const sh = el();
    const root = storiesRoot(() => sh);
    W.WQHOME.loadOnce('wq-stories');
    W.WQDOORS.mount(root, STORIES_B, C, 'stories');
    script.fire('error');
    expect(sh.innerHTML).toMatch(/data-primary/);
    expect(visible(sh.innerHTML)).toMatch(/Try again/);
    expect(root.attrs['data-fetch']).toBe('failed');
  });
  test('a reader whose shelf throws: the retry, never a skeleton left forever', () => {
    const { W } = live({ win: { WQSTORIES: { shelf() { throw new Error('boom'); } } } });
    const sh = el();
    const root = storiesRoot(() => sh);
    W.WQDOORS.mount(root, STORIES_B, C, 'stories');
    expect(visible(sh.innerHTML || '')).toMatch(/Try again/);
    expect(root.attrs['data-fetch']).toBe('failed');
  });
  test('switch off: a reader whose shelf throws is left as today (no retry painted)', () => {
    const { W } = live({ win: { WQSTORIES: { shelf() { throw new Error('boom'); } } } });
    const sh = el();
    const root = storiesRoot(() => sh);
    W.WQDOORS.mount(root, { ...STORIES_B, list_states: 0 }, C, 'stories');
    expect(sh.innerHTML).toBeUndefined();
    expect(root.attrs['data-fetch']).toBeUndefined();
  });
});

describe('the Stories door: a server that answers its own failure keeps the boot\'s shelf (never "no stories")', () => {
  const NOTE = 'New stories are on the way';
  const shown = (h) => visible(h.replace(/<div data-shelf-fallback="1" hidden>[\s\S]*?<\/div><\/div>/, ''));
  test('{stories: [], shelf: false, err: 1}: one paint, the boot\'s shelf slot with its skeleton, the note hidden', async () => {
    const { W, fetch } = live({ fetchImpl: (u) => (/d=stories/.test(u) ? OK({ stories: [], shelf: false, err: 1 })() : new Promise(() => {})) });
    const r = paintRoot();
    W.WQDOORS.mount(r, B_ON, C, 'stories');
    await flush();
    expect(fetch.mock.calls.filter((c) => /d=stories/.test(c[0]))).toHaveLength(1);
    expect(r.paints).toHaveLength(1);
    expect(r.paints[0]).toMatch(/data-stories-shelf="1"/);
    expect(r.paints[0]).toMatch(/aria-busy="true"/);
    expect(r.paints[0]).toMatch(/<div data-shelf-fallback="1" hidden>/);
    expect(shown(r.paints[0])).not.toContain(NOTE);
  });
  test('the contrast: rows that came back whole with no shelf ({stories: [], shelf: false}) draw the note', async () => {
    const { W } = live({ fetchImpl: (u) => (/d=stories/.test(u) ? OK({ stories: [], shelf: false })() : new Promise(() => {})) });
    const r = paintRoot();
    W.WQDOORS.mount(r, B_ON, C, 'stories');
    await flush();
    expect(r.paints).toHaveLength(2);
    expect(shown(r.paints[1])).toContain(NOTE);
  });
});

describe('one tap lights only the card', () => {
  const css = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
  test('the quiz Home button\'s style is only on a link or a button, never a bare .wq-home (the home screen\'s own section)', () => {
    const bare = rules.filter((sel) => sel.split(',').some((s) => /(^|[\s>+~])\.wq-home(?![-\w])/.test(s.trim()) && !/(^|[\s>+~])(a|button)\.wq-home(?![-\w])/.test(s.trim())));
    expect(bare).toEqual([]);
    expect(css).toMatch(/a\.wq-home,button\.wq-home\{display:inline-flex/);
  });
  test('rows, speakers, doors and the home buttons drop the browser\'s own tap flash', () => {
    expect(css).toMatch(/\.wq-row,\.wq-dspk,\.wq-door,\.wq-homebtn\{-webkit-tap-highlight-color:transparent\}/);
  });
});

describe('a quiz the child opened (from a video) is not the teacher\'s', () => {
  const LAST = { kind: 'quiz', code: 'VID001', k: 'kv', topic: 'Life cycle of a hen', subject: 'Science', done: false, from: 'last' };
  const TEACHER = { kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' };
  const heads = (h) => (h.match(/<h3 class="wq-dsec"><bdi[^>]*>([^<]*)<\/bdi>/g) || []).map((x) => x.replace(/<[^>]*>/g, ''));
  const primaryRow = (h) => { const m = h.match(/<(a|button) class="wq-row wq-drow" data-primary[^>]*data-item="([^"]*)"/); return m && m[2]; };
  test.each([['en', 'From your teacher', 'Your last quiz'], ['ur', 'ٹیچر کی طرف سے', 'آپ کا پچھلا کوئز']])('%s: only an opened quiz: no "From your teacher" heading; it sits under the last-quiz heading and does not take the primary over the games', (lang, teacherHead, lastHead) => {
    const W = load();
    const h = W.WQDOORS.html({ ...bootOf(lang, ON), doors: { stories: [], games: [LAST, { kind: 'numbers' }], videos: null } }, { token: TOKEN, lang }, 'games', GAMES);
    expect(heads(h)).not.toContain(teacherHead);
    expect(heads(h)).toContain(lastHead);
    expect(primaryRow(h)).toBe('missing');
    expect(count(h, /data-primary/g)).toBe(1);
  });
  test('the teacher\'s quiz and an opened one: the teacher\'s under its heading and the primary, the opened one under the last-quiz heading', () => {
    const W = load();
    const h = W.WQDOORS.html({ ...B_ON, doors: { stories: [], games: [TEACHER, LAST, { kind: 'numbers' }], videos: null } }, C, 'games', GAMES);
    expect(heads(h)[0]).toBe('From your teacher');
    expect(primaryRow(h)).toBe('MATH01');
    const teacherPart = h.split('Your last quiz')[0];
    expect(teacherPart).not.toContain('VID001');
    expect(h.split('Your last quiz')[1]).toContain('VID001');
  });
  test('GOLDEN off: an opened quiz still lists under "From your teacher" as today', () => {
    const W = load();
    const h = W.WQDOORS.html({ ...bootOf('en', {}), doors: { stories: [], games: [LAST], videos: null } }, C, 'games', GAMES);
    expect(heads(h)[0]).toBe('From your teacher');
    expect(primaryRow(h)).toBe('VID001');
  });
});

describe('the test markers (switch on only): data-fetch, data-skel-from|to, data-empty-at on the door root', () => {
  test('Games: pending with a skeleton stamp, then done with the skeleton\'s end stamp; no empty stamp for a list with rows', async () => {
    let answer;
    const { W } = live({ fetchImpl: (u) => (/d=games/.test(u) ? new Promise((res) => { answer = res; }) : new Promise(() => {})) });
    const r = paintRoot();
    W.WQDOORS.mount(r, B_ON, C, 'games');
    expect(r.attrs['data-fetch']).toBe('pending');
    expect(r.attrs['data-skel-from']).toMatch(/^\d+$/);
    expect(r.attrs['data-skel-to']).toBeUndefined();
    answer({ ok: true, status: 200, json: () => Promise.resolve(GAMES) });
    await flush();
    expect(r.attrs['data-fetch']).toBe('done');
    expect(r.attrs['data-skel-to']).toMatch(/^\d+$/);
    expect(r.attrs['data-empty-at']).toBeUndefined();
  });
  test('Games: rows that came back empty: done, with an empty stamp; a failed read: failed, no empty stamp', async () => {
    const { W } = live({ fetchImpl: OK({ games: [] }) });
    const r = paintRoot();
    W.WQDOORS.mount(r, { ...B_ON, doors: { stories: [], games: [], videos: null } }, C, 'games');
    await flush();
    expect(r.attrs['data-fetch']).toBe('done');
    expect(r.attrs['data-empty-at']).toMatch(/^\d+$/);
    const f = live({ fetchImpl: OK({ games: [], err: 1 }) });
    const r2 = paintRoot();
    f.W.WQDOORS.mount(r2, B_ON, C, 'games');
    await flush();
    expect(r2.attrs['data-fetch']).toBe('failed');
    expect(r2.attrs['data-empty-at']).toBeUndefined();
  });
  test('switch off: no test-marker attribute is written', async () => {
    const { W } = live({ fetchImpl: OK(GAMES) });
    const r = paintRoot();
    W.WQDOORS.mount(r, bootOf('en', {}), C, 'games');
    await flush();
    expect(Object.keys(r.attrs).filter((k) => /^data-(fetch|skel|empty)/.test(k))).toEqual([]);
  });
});

describe('one mark for a true empty, and two list writers that keep apart (switch on only)', () => {
  test.each(['en', 'ur'])('%s: a true empty note carries data-empty (the walkers\' "no empty while busy" mark); the waiting note does not', (lang) => {
    const W = load();
    const s = screensFor(lang, ON, W);
    expect(s.gamesNone).toMatch(/class="wq-dempty" data-empty/);
    expect(s.storiesNone).toMatch(/class="wq-dempty" data-empty/);
    expect(s.gamesBoot).not.toMatch(/data-empty/);
    expect(s.storiesBoot.split('data-shelf-fallback')[0]).not.toMatch(/data-empty/);
  });
  test('switch off: no data-empty mark anywhere', () => {
    const s = screensFor('en', {});
    Object.values(s).forEach((h) => expect(h).not.toMatch(/data-empty/));
  });
  test('Games, then the Videos shelves, then Games again: each list starts its own spell, neither keeps the other\'s stamps', async () => {
    const B = { ...B_ON, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true, shelf: true } } };
    const { W } = live({ fetchImpl: (u) => (/d=games/.test(u) ? OK(GAMES)() : new Promise(() => {})) });
    const r = paintRoot();
    W.WQDOORS.mount(r, B, C, 'games');
    await flush();
    expect(r.attrs['data-trip']).toBe('games');
    expect(r.attrs['data-fetch']).toBe('done');
    W.WQDOORS.mount(r, B, C, 'videos'); // the shelves' own writer: pending until every shelf settles
    await flush();
    expect(r.attrs['data-vtrip']).toBe('videos');
    expect(r.attrs['data-fetch']).toBe('pending');
    const videosFrom = r.attrs['data-skel-from'];
    expect(videosFrom).toMatch(/^\d+$/);
    W.WQDOORS.mount(r, B, C, 'games'); // the rows are kept: one paint, no skeleton
    await flush();
    expect(r.attrs['data-trip']).toBe('games');
    expect(r.attrs['data-vtrip']).toBeUndefined();
    expect(r.attrs['data-fetch']).toBe('done');
    expect(r.attrs['data-skel-from']).toBeUndefined(); // not the Videos spell's start
    expect(r.attrs['data-skel-to']).toBeUndefined();
    W.WQDOORS.mount(r, B, C, 'videos');
    await flush();
    expect(r.attrs['data-vtrip']).toBe('videos');
    expect(r.attrs['data-fetch']).toBe('pending');
    expect(r.attrs['data-skel-to']).toBeUndefined();
  });
});

describe('the Stories door\'s shelf that did not load (the reader\'s own Try again sheet)', () => {
  const rig = (lang) => {
    const { W, observers } = live({ win: { WQSTORIES: { shelf: jest.fn() } } });
    const sh = el(); const btn = el(); btn.setAttribute('data-primary', ''); const fb = el({ querySelector: (q) => (q === '.wq-go' ? btn : null) });
    fb.hidden = true;
    const root = { innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; }, querySelector: (q) => ({ '[data-stories-shelf]': sh, '[data-shelf-fallback]': fb })[q] || null, querySelectorAll: () => [] };
    return { W, observers, sh, fb, root, c: { ...C, lang } };
  };
  // the reader's sheet as wq-stories.js draws it on a failed shelf GET: its words name one book
  const sheet = (words) => { const say = { textContent: words }; return { say, el: el({ querySelector: (q) => (q === '.wqs-say' ? say : null) }) }; };
  test.each([['en', 'Jugnu could not open this.', 'The stories could not open yet.'], ['ur', 'یہ کتاب ابھی نہیں کھل سکی۔', 'کہانیاں ابھی نہیں کھل سکیں۔']])('%s: switch on: the sheet names the stories, the door says failed, no empty note', (lang, book, stories) => {
    const r = rig(lang);
    r.W.WQDOORS.mount(r.root, { ...bootOf(lang, ON), doors: { stories: [{ kind: 'shelf' }], games: [], videos: null } }, r.c, 'stories');
    const s = sheet(book);
    r.sh.setAttribute('data-filled', '1');
    r.sh.querySelector = (q) => (q === '[data-screen="stories-retry"]' ? s.el : q === '[data-primary]' ? el() : null);
    r.observers.forEach((cb) => cb());
    expect(s.say.textContent).toBe(stories);
    expect(r.root.attrs['data-fetch']).toBe('failed');
    expect(r.root.attrs['data-empty-at']).toBeUndefined();
    expect(r.fb.hidden).toBe(true);
  });
  test('switch off: the reader\'s sheet keeps today\'s words', () => {
    const r = rig('en');
    r.W.WQDOORS.mount(r.root, { ...bootOf('en', {}), doors: { stories: [{ kind: 'shelf' }], games: [], videos: null } }, r.c, 'stories');
    const s = sheet('Jugnu could not open this.');
    r.sh.setAttribute('data-filled', '1');
    r.sh.querySelector = (q) => (q === '[data-screen="stories-retry"]' ? s.el : q === '[data-primary]' ? el() : null);
    r.observers.forEach((cb) => cb());
    expect(s.say.textContent).toBe('Jugnu could not open this.');
  });
});
