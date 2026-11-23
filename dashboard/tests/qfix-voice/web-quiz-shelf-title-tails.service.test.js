/**
 * An Urdu title on the Videos shelf shows its Nastaliq tails whole when its 2-line clamp hides nothing, and a clamped
 * English title on the Urdu grid ends with its "…" (wq-doors.css `.wq-vct`, wq-doors.js vfit).
 *
 * Bug (Nov 2026, production): the clamp's clip cut the tails of ر ے ی م ں under the box on 657 of 887 production Urdu
 * titles (up to 6 CSS px), 633 of them titles of one or two lines that the clamp hides nothing of. Lifting the clip with a
 * margin instead lets the top of a hidden third line show on a quarter of the clamped titles, so only a title whose
 * content fits is marked (.wq-vfit) and drawn unclipped. Nastaliq ink overflows its own line box (4-5 px of
 * scrollHeight on every title), so "fits" = less than half a line of scroll overflow; a clamped title hides a whole one.
 *
 * Bug 2: a clamped English title on the Urdu grid (adventure look) lost its "…": the line was right-aligned, so the
 * ellipsis Chrome appends after "Groups by" fell past the box's right edge and was clipped. It reads from its own edge.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { computed, node, root } = require('./cascade');

const DOORS = [root('wq.css'), root('wq-doors.css')];
const value = (p, prop) => (computed(p, prop, DOORS) || {}).value;
const titlePath = (lang, { adv = false, latin = false, fit = false } = {}) => [
  node('html', adv ? ['wq-adv'] : [], { lang }), node('body'), node('div', ['wq-vrow']), node('div', ['wq-vcard']), node('button', ['wq-vtap']),
  node('b', fit ? ['wq-vct', 'wq-vfit'] : ['wq-vct'], {}, undefined, [node('bdi', latin ? ['wq-lat'] : [])]),
];

describe('wq-doors.css: an Urdu title the clamp hides nothing of is drawn unclipped; a clamped one keeps its clip', () => {
  test('an Urdu title marked .wq-vfit: overflow visible (its tails whole), still the 2-line clamp', () => {
    expect(value(titlePath('ur', { fit: true }), 'overflow')).toBe('visible');
    expect(value(titlePath('ur', { fit: true }), '-webkit-line-clamp')).toBe('2');
  });
  test.each([[false], [true]])('an Urdu title not marked (clamped, or not laid out yet), advanced look %s: clipped as before', (adv) => {
    expect(value(titlePath('ur', { adv }), 'overflow')).toBe('hidden');
  });
  test('an English page: the marker changes nothing (no Nastaliq tails there)', () => {
    expect(value(titlePath('en', { fit: true }), 'overflow')).toBe('hidden');
  });
  test('a clamped English title on the Urdu grid (advanced look) reads from its own left edge, so its "…" shows', () => {
    const p = titlePath('ur', { adv: true, latin: true });
    expect(value(p, 'direction')).toBe('ltr');
    expect(value(p, 'text-align')).toBe('left');
  });
});

// The live door, as doors-v3 drives it: wq-home.js + wq-doors.js in a vm, a small fake DOM, fetch at the network boundary.
const WQ = path.join(__dirname, '..', '..', 'public', 'wq');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const SUBJECTS = { grade: '3', subjects: [{ key: 'Science', n: 3, art: '/wq/art/subject-science.webp' }] };
const CHAPTERS = { grade: '3', subject: 'Science', quiz: true, chapters: [{ name: 'باب ۱', videos: [
  { vid: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'One', title_ur: 'کسور کی اقسام', secs: 143, thumb: '/wq/vt/a1.webp' },
  { vid: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Two', title_ur: 'گنجائش: ملی لیٹر اور لیٹر', secs: 200, thumb: '/wq/vt/a2.webp' },
  { vid: 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Three', title_ur: 'توانائی کے قابلِ تجدید اور ناقابلِ تجدید ذرائع اور ان کا استعمال', secs: 90, thumb: '/wq/vt/a3.webp' },
] }] };
const B = { lang: 'ur', kids: [{ chip: '0123456789abcdef', first: 'Zara', animal: 'owl', grade: '3' }], kid: '0123456789abcdef', teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false,
  home_v3: 1, doors: { stories: [], games: [], videos: { href: '/lib/x', watch: true, shelf: true } } };
const CTX = { token: TOKEN, lang: 'ur', ev() {} };

// A title as the browser lays it out: scroll overflow = (scrollHeight - clientHeight), line height 28.5 px (15 px × 1.9).
function titleEl(sh, ch) {
  const set = new Set(['wq-vct']);
  return { scrollHeight: sh, clientHeight: ch, lh: '28.5px', classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) } };
}
const fit = (t) => t.classList.contains('wq-vfit');
function el(extra = {}) {
  return { attrs: {}, listeners: {}, parentNode: { removeChild() {} }, innerHTML: '', setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n) { (this.listeners[n] || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {} })); }, querySelector: () => null, querySelectorAll: () => [], ...extra };
}
function live(titles = {}) {
  const fontsOn = [];
  const resizeOn = [];
  const timers = [];
  const document = { getElementById: () => null, querySelector: () => null, createElement: (tag) => el({ tag }), head: { appendChild() {} },
    querySelectorAll: (sel) => (sel === '.wq-vct' ? [...(titles.shelf || []), ...(titles.grid || [])] : []),
    fonts: { addEventListener: (n, fn) => { if (n === 'loadingdone') fontsOn.push(fn); } } };
  const fetch = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/[?&]s=/.test(url) ? CHAPTERS : SUBJECTS) });
  const win = { scrollTo() {}, addEventListener: (n, fn) => { if (n === 'resize') resizeOn.push(fn); }, getComputedStyle: (e) => ({ lineHeight: e.lh || 'normal' }) };
  // the page's own timers run as usual; the resize read's 250 ms wait is held here, so the test says when it is due
  const setT = (fn, ms) => { if (ms === 250) { timers.push({ fn }); return timers.length; } return setTimeout(fn, ms); };
  const clearT = (id) => { if (typeof id === 'number' && timers[id - 1]) timers[id - 1].ran = true; else clearTimeout(id); };
  const sandbox = { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent, Date, isFinite, RegExp,
    fetch, document, location: { hash: '', pathname: `/h/${TOKEN}`, search: '' }, MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }, setImmediate, setTimeout: setT, clearTimeout: clearT };
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-home.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(WQ, 'wq-doors.js'), 'utf8'), sandbox);
  return { W: win, fontsOn, resizeOn, timers };
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

describe('wq-doors.js: the shelf and the See all grid mark each title whose content fits (.wq-vfit)', () => {
  test('a subject\'s shelf filled with its lessons: one line (4 px of ink) and two lines (5 px) fit; a clamped title (33 px) does not', async () => {
    const one = titleEl(38.5, 34.5); const two = titleEl(68, 63); const clamped = titleEl(96, 63);
    const shelfEl = el({ querySelectorAll: (sel) => (sel === '.wq-vct' ? [one, two, clamped] : []) });
    const { W } = live({ shelf: [one, two, clamped] });
    const rootEl = el({ querySelector: (sel) => (sel === '[data-vshelf="Science"]' ? shelfEl : null) });
    W.WQDOORS.mount(rootEl, B, CTX, 'videos');
    await flush();
    expect(shelfEl.innerHTML).toContain('کسور کی اقسام');
    expect([fit(one), fit(two), fit(clamped)]).toEqual([true, true, false]);
  });

  test('a title not laid out yet (no height: a hidden view) is left clipped, and loses a mark it had', async () => {
    const hidden = titleEl(0, 0); hidden.classList.add('wq-vfit');
    const shelfEl = el({ querySelectorAll: (sel) => (sel === '.wq-vct' ? [hidden] : []) });
    const { W } = live({ shelf: [hidden] });
    W.WQDOORS.mount(el({ querySelector: (sel) => (sel === '[data-vshelf="Science"]' ? shelfEl : null) }), B, CTX, 'videos');
    await flush();
    expect(fit(hidden)).toBe(false);
  });

  test('See all: the subject\'s grid is marked the same way when it is drawn', async () => {
    const one = titleEl(38.5, 34.5); const clamped = titleEl(125, 63);
    const subj = el(); subj.setAttribute('data-tap', 'subj'); subj.setAttribute('data-item', 'Science'); subj.setAttribute('data-pos', '0');
    const { W } = live({ grid: [one, clamped] });
    const rootEl = el({ querySelectorAll: (sel) => (sel === '[data-tap]' ? [subj] : sel === '.wq-vct' ? [one, clamped] : []) });
    W.WQDOORS.mount(rootEl, B, CTX, 'videos');
    await flush();
    one.classList.remove('wq-vfit'); // the shelf screen's own marks aside: the grid's draw is the one read here
    subj.fire('click');
    await flush();
    expect(rootEl.innerHTML).toMatch(/class="wq-vgrid"/);
    expect([fit(one), fit(clamped)]).toEqual([true, false]);
  });

  test('the Urdu face arriving late re-reads every title: one the new face clamps loses its mark', async () => {
    const t = titleEl(38.5, 34.5);
    const shelfEl = el({ querySelectorAll: (sel) => (sel === '.wq-vct' ? [t] : []) });
    const { W, fontsOn } = live({ shelf: [t] });
    W.WQDOORS.mount(el({ querySelector: (sel) => (sel === '[data-vshelf="Science"]' ? shelfEl : null) }), B, CTX, 'videos');
    await flush();
    expect(fit(t)).toBe(true);
    t.scrollHeight = 96; t.clientHeight = 63; // the face loaded: the title now runs to 3 lines and is clamped
    expect(fontsOn.length).toBeGreaterThan(0);
    fontsOn.forEach((fn) => fn());
    expect(fit(t)).toBe(false);
  });

  test('a width change (rotation, split screen) re-reads every title once it settles (one debounced read)', async () => {
    const t = titleEl(96, 63);
    const shelfEl = el({ querySelectorAll: (sel) => (sel === '.wq-vct' ? [t] : []) });
    const { W, resizeOn, timers } = live({ shelf: [t] });
    W.WQDOORS.mount(el({ querySelector: (sel) => (sel === '[data-vshelf="Science"]' ? shelfEl : null) }), B, CTX, 'videos');
    await flush();
    expect(fit(t)).toBe(false);
    t.scrollHeight = 68; // landscape: the same title now fits on 2 lines
    expect(resizeOn.length).toBeGreaterThan(0);
    resizeOn.forEach((fn) => fn()); resizeOn.forEach((fn) => fn());
    expect(fit(t)).toBe(false); // not on every resize event
    const due = timers.filter((x) => !x.ran);
    expect(due).toHaveLength(1);
    due.forEach((x) => { x.ran = true; x.fn(); });
    expect(fit(t)).toBe(true);
  });
});
