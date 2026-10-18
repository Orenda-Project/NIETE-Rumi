/**
 * The Videos door's thumbnail shelves and the way into each video's quiz (app_settings web_quiz_video_shelf; the bot
 * names it on the boot's videos door as `shelf: true`). On: every subject is a shelf of picture cards (the small
 * thumbnail, lazy and sized, a placeholder while it loads), a subject opens as a grid of cards, every card whose quiz can
 * be played has a Quiz button, and the watch screen offers the quiz from the first second. Off: every Videos screen is
 * byte-identical to the golden written on the base. Invented children and lessons only.
 */
const fs = require('fs');
const path = require('path');
const F = require('./web-quiz-video-shelf.fixture');

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'web-quiz-video-shelf-off.golden.json'), 'utf8'));
const { TOKEN, KID, VID, VID2, LIB_SUBJECTS, LIB_CHAPTERS, WATCH } = F;
const SHELF = (extra = {}) => ({ href: '/lib/x', watch: true, shelf: true, ...extra });
const THUMB = (v) => `/wq/vt/${v}.webp`;
const CH = { ...LIB_CHAPTERS, quiz: true, chapters: LIB_CHAPTERS.chapters.map((c) => ({ ...c, videos: c.videos.map((v) => ({ ...v, thumb: THUMB(v.vid) })) })) };
const count = (html, rx) => (html.match(rx) || []).length;
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ');
const BANNED = /\b(test|tests|exam|assess\w*|score|rank|level)\b|امتحان|ٹیسٹ/i;

describe('GOLDEN: web_quiz_video_shelf off -> every Videos screen as today', () => {
  test('both languages, a class-less and a class child: byte-identical to the base', () => {
    expect(F.offScreens()).toEqual(GOLDEN);
  });
});

describe('the shelves (switch on)', () => {
  test.each(['en', 'ur'])('%s: one shelf per subject, a placeholder card row while its lessons load, one primary', (lang) => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot(lang, SHELF()), { token: TOKEN, lang }, 'videos', { lib: LIB_SUBJECTS });
    expect(count(h, /data-vshelf="/g)).toBe(2);
    expect(h).toMatch(/data-vshelf="Science"/);
    expect(h).toMatch(/class="wq-vcard wq-vskel"/);
    expect(count(h, /data-primary/g)).toBe(1);
    expect(h).toMatch(/data-tap="subj"[^>]*data-item="Science"/); // "See all" opens the subject
    expect(visible(h)).not.toMatch(BANNED);
  });
  test('a shelf with its lessons: picture cards with the small thumbnail (lazy, sized, async), minutes, the done tick', () => {
    const W = F.load();
    const h = W.WQDOORS.shelfHtml(CH, { token: TOKEN, lang: 'en' }, 'Science');
    expect(count(h, /class="wq-vcard"/g)).toBe(2);
    expect(h).toMatch(new RegExp(`<img class="wq-vtimg" src="${THUMB(VID).replace(/\./g, '\\.')}" alt="" width="320" height="180" loading="lazy" decoding="async"`));
    expect(h).toContain('data-f="https://r2.example.test/p1_poster.jpg?sig"'); // a broken thumbnail falls back to the poster
    expect(h).toContain('3 min');
    expect(h).toMatch(/wq-vdone/);
    expect(h).toMatch(/data-tap="vid"[^>]*data-item="aaaaaaa1/);
  });
  test('Urdu: the lesson\'s Urdu title, Urdu digits in the minutes', () => {
    const W = F.load();
    const ch = { ...CH, chapters: [{ ...CH.chapters[0], videos: [{ ...CH.chapters[0].videos[0], title_ur: 'مرغی کی زندگی' }] }] };
    const h = W.WQDOORS.shelfHtml(ch, { token: TOKEN, lang: 'ur' }, 'Science');
    expect(h).toContain('مرغی کی زندگی');
    expect(h).toContain('۲ منٹ');
    expect(visible(h)).not.toMatch(/[0-9]/);
  });
  test('a Quiz button on every card whose quiz can be played (a class code, or the server says quiz: true)', () => {
    const W = F.load();
    const on = W.WQDOORS.shelfHtml(CH, { token: TOKEN, lang: 'en' }, 'Science');
    expect(count(on, /data-tap="vquiz"/g)).toBe(2);
    expect(on).toMatch(/data-tap="vquiz"[^>]*data-item="aaaaaaa2[^"]*"/);
    expect(visible(on)).toContain('Quiz');
    // no class and no root: only the card that already has its class code
    const off = W.WQDOORS.shelfHtml({ ...CH, quiz: false }, { token: TOKEN, lang: 'en' }, 'Science');
    expect(count(off, /data-tap="vquiz"/g)).toBe(1);
    const ur = W.WQDOORS.shelfHtml(CH, { token: TOKEN, lang: 'ur' }, 'Science');
    expect(visible(ur)).toContain('کوئز');
  });
  test.each(['en', 'ur'])('%s: while the subjects load, placeholder shelves (never words saying a video is opening), one primary', (lang) => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot(lang, SHELF()), { token: TOKEN, lang }, 'videos', { lib: null });
    expect(h).not.toContain(lang === 'ur' ? 'ویڈیو کھل رہی ہے…' : 'Opening the video…');
    expect(count(h, /class="wq-vcard wq-vskel"/g)).toBe(6);
    expect(h).toMatch(/aria-busy="true"/);
    expect(count(h, /data-primary/g)).toBe(1);
  });
  test('a subject opened while its lessons load: a placeholder grid under Back (never "Opening the video…"), one primary', () => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot('en', SHELF()), { token: TOKEN, lang: 'en' }, 'videos', { subject: 'Science', lib: null });
    expect(h).not.toContain('Opening the video…');
    expect(h).toMatch(/data-tap="subjects"/);
    expect(count(h, /class="wq-vcard wq-vskel"/g)).toBe(4);
    expect(count(h, /data-primary/g)).toBe(1);
  });
  test('a subject opened: a grid of cards under its chapter heads, Back, one primary', () => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot('en', SHELF()), { token: TOKEN, lang: 'en' }, 'videos', { subject: 'Science', lib: CH });
    expect(h).toMatch(/class="wq-vgrid"/);
    expect(h).toContain('Chapter 1');
    expect(h).toMatch(/data-tap="subjects"/);
    expect(count(h, /data-primary/g)).toBe(1);
    expect(count(h, /class="wq-vcard"/g)).toBe(2);
  });
  test('no extra stylesheet request: the shelf rules ride the door screens\' own wq-doors.css (new class names only)', () => {
    const W = F.load();
    const on = W.WQDOORS.html(F.boot('en', SHELF()), { token: TOKEN, lang: 'en' }, 'videos', { lib: LIB_SUBJECTS })
      + W.WQDOORS.html(F.boot('en', SHELF()), { token: TOKEN, lang: 'en' }, `watch/${VID}`, { watch: WATCH, next: null });
    expect(on).not.toMatch(/<link/);
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-doors.css'), 'utf8');
    ['.wq-vrow', '.wq-vgrid', '.wq-vcard', '.wq-vthumb', '.wq-vskel', '.wq-vq', '.wq-vquiz'].forEach((c) => expect(css).toContain(c));
    expect(fs.existsSync(path.join(__dirname, '..', 'public', 'wq', 'wq-vshelf.css'))).toBe(false);
  });
  test('one record per card: the thumbnail, the title, the minutes and both taps name the same lesson', () => {
    const W = F.load();
    const h = W.WQDOORS.shelfHtml(CH, { token: TOKEN, lang: 'en' });
    const cards = h.split('<div class="wq-vcard">').slice(1);
    expect(cards).toHaveLength(2);
    CH.chapters[0].videos.forEach((v, i) => {
      const c = cards[i];
      expect(c).toContain(`src="/wq/vt/${v.vid}.webp"`);
      expect(c).toContain(`data-tap="vid" data-item="${v.vid}"`);
      expect(c).toContain(v.title);
      expect((c.match(/data-item="([^"]+)"/g) || []).every((m) => m === `data-item="${v.vid}"`)).toBe(true);
    });
  });
  test('the Quiz and See all buttons come from the one button system (wq-btn + one kind)', () => {
    const W = F.load();
    const shelf = W.WQDOORS.shelfHtml(CH, { token: TOKEN, lang: 'en' });
    const subj = W.WQDOORS.html(F.boot('en', SHELF()), { token: TOKEN, lang: 'en' }, 'videos', { lib: LIB_SUBJECTS });
    const watch = W.WQDOORS.html(F.boot('en', SHELF()), { token: TOKEN, lang: 'en' }, `watch/${VID}`, { watch: WATCH, next: null });
    expect(shelf).toMatch(/<button class="wq-btn wq-btn--secondary wq-vq" type="button" data-tap="vquiz"/);
    expect(subj).toMatch(/<button class="wq-btn wq-btn--secondary wq-vsall" type="button"/);
    expect(watch).toMatch(/<button class="wq-btn wq-btn--secondary wq-vquiz" type="button" data-tap="vquiz"/);
  });
});

describe('the watch screen offers the quiz from the first second (switch on)', () => {
  test.each(['en', 'ur'])('%s: the play leads; a visible Play the quiz button below the title when the quiz can be played', (lang) => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot(lang, SHELF()), { token: TOKEN, lang }, `watch/${VID}`, { watch: WATCH, next: { kind: 'quiz', title: 'Play the quiz', sub: WATCH.title, href: '#' } });
    expect(h).toMatch(/class="wq-vplay" type="button" data-primary/);
    expect(h).toMatch(/<button class="wq-btn wq-btn--secondary wq-vquiz" type="button" data-tap="vquiz" data-item="aaaaaaa1/);
    expect(h.indexOf('wq-vquiz')).toBeLessThan(h.indexOf('wq-after'));
    expect(count(h, /data-primary/g)).toBe(1);
  });
  test('no quiz for this child (no class, no root): no button', () => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot('en', SHELF()), { token: TOKEN, lang: 'en' }, `watch/${VID}`, { watch: { ...WATCH, after: false }, next: null });
    expect(h).not.toMatch(/wq-vquiz/);
  });
});

// --- live: taps --------------------------------------------------------------------------------------------------
function el(extra = {}) {
  return {
    attrs: {}, hidden: false, listeners: {}, parentNode: null, innerHTML: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || { preventDefault() {}, stopPropagation() {} })); },
    querySelector: () => null, ...extra,
  };
}
const FAIL = Symbol('a request that fails');
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };
function live(answers) {
  const fetch = jest.fn((url, o) => {
    const j = answers(url, o);
    if (j === FAIL) return Promise.resolve({ ok: false, status: 504, json: () => Promise.reject(new Error('504')), text: () => Promise.resolve('') });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
  });
  const shelves = {};
  const taps = [];
  const root = {
    innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    querySelector: (sel) => { const m = /^\[data-vshelf="(.+)"\]$/.exec(sel); if (m) return (shelves[m[1]] = shelves[m[1]] || el()); return null; },
    querySelectorAll: (sel) => (sel === '[data-tap]' ? taps : []),
  };
  const head = [];
  const document = { getElementById: () => null, querySelector: (s) => (/hub\.js/.test(s) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null), createElement: (tag) => el({ tag }), head: { appendChild: (x) => head.push(x) } };
  const W = F.load({ win: { scrollTo() {}, addEventListener() {} }, globals: { fetch, document, location: { hash: '', pathname: `/h/${TOKEN}`, search: '' }, MutationObserver: function () { this.observe = () => {}; }, setImmediate, setTimeout } });
  return { W, fetch, root, shelves, taps, head };
}

describe('live (switch on)', () => {
  test('the door fills every subject\'s shelf from the library, each in place (no whole-screen redraw)', async () => {
    const t = live((url) => (/[?&]s=Science/.test(url) ? CH : /[?&]s=Maths/.test(url) ? { ...CH, subject: 'Maths' } : LIB_SUBJECTS));
    const go = jest.fn();
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), { token: TOKEN, lang: 'en', ev() {}, go }, 'videos');
    await flush();
    const urls = t.fetch.mock.calls.map(([u]) => u);
    expect(urls.some((u) => /\/api\/wq\/lib\/h\/[^?]+\?kid=[^&]+&l=en$/.test(u))).toBe(true);
    expect(urls.some((u) => /&s=Science/.test(u))).toBe(true);
    expect(urls.some((u) => /&s=Maths/.test(u))).toBe(true);
    expect(t.shelves.Science.innerHTML).toMatch(/class="wq-vcard"/);
    expect(t.shelves.Maths.innerHTML).toMatch(/class="wq-vcard"/);
  });
  test('Quiz on a class card: straight to its questions (/q/<code>?k=..&via=videos&to=q), nothing minted', async () => {
    const t = live((url) => (/[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    const go = jest.fn();
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), { token: TOKEN, lang: 'en', ev() {}, go }, 'videos');
    await flush();
    const q = el(); q.setAttribute('data-tap', 'vquiz'); q.setAttribute('data-item', VID2);
    t.taps.push(q);
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), { token: TOKEN, lang: 'en', ev() {}, go }, 'videos');
    await flush();
    q.fire('click');
    await flush();
    expect(go).toHaveBeenCalledWith('/q/SCI002?k=kk2&via=videos&to=q', 'door_quiz');
    expect(t.fetch.mock.calls.filter(([u]) => /videos\/start/.test(u))).toHaveLength(0);
  });
  test('Quiz on a class-less card: the quiz is minted on the tap (POST after:1) and opens at its questions', async () => {
    const t = live((url, o) => (/videos\/start/.test(url) ? { code: 'WAT001', k: 'kw' } : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    const go = jest.fn();
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), { token: TOKEN, lang: 'en', ev() {}, go }, 'videos');
    await flush();
    const q = el(); q.setAttribute('data-tap', 'vquiz'); q.setAttribute('data-item', VID);
    t.taps.push(q);
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), { token: TOKEN, lang: 'en', ev() {}, go }, 'videos');
    await flush();
    q.fire('click');
    await flush();
    const posts = t.fetch.mock.calls.filter(([u]) => /videos\/start/.test(u)).map(([, o]) => JSON.parse(o.body));
    expect(posts).toEqual([{ hub: TOKEN, kid: KID, vid: VID, after: 1 }]);
    expect(go).toHaveBeenCalledWith('/q/WAT001?k=kw&to=q', 'door_quiz');
  });
});

describe('the first row paints first (switch on)', () => {
  test('the first subject\'s first three pictures load at once; every other picture is lazy', async () => {
    const t = live((url) => (/[?&]s=/.test(url) ? { ...CH, chapters: [{ ...CH.chapters[0], videos: [0, 1, 2, 3].map((i) => ({ ...CH.chapters[0].videos[0], vid: `aaaaaaa${i + 1}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, code: undefined })) }] } : LIB_SUBJECTS));
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), { token: TOKEN, lang: 'en', ev() {}, go: jest.fn() }, 'videos');
    await flush();
    const imgs = (h) => h.match(/<img class="wq-vtimg"[^>]*>/g) || [];
    const first = imgs(t.shelves.Science.innerHTML);
    expect(first).toHaveLength(4);
    expect(first.slice(0, 3).every((i) => !/loading="lazy"/.test(i) && /width="320" height="180"/.test(i))).toBe(true);
    expect(first[3]).toMatch(/loading="lazy"/);
    expect(imgs(t.shelves.Maths.innerHTML).every((i) => /loading="lazy"/.test(i))).toBe(true);
  });
});

describe('the watch screen\'s Quiz button outlives the end card (switch on, card_v3 on)', () => {
  test.each(['en', 'ur'])('%s: video ended + finish card mounted -> the Quiz button is still on the screen and opens the quiz', async (lang) => {
    const after = el({ hidden: true }); const holder = el({ removeChild(x) { if (x === after) after.gone = true; } }); after.parentNode = holder;
    const vEl = el({ duration: 100, currentTime: 100 });
    const t = live((url, o) => (/videos\/start/.test(url) ? (JSON.parse(o.body).after ? { code: 'WAT001', k: 'kw' } : { watch: WATCH }) : LIB_SUBJECTS));
    const q = el(); q.setAttribute('data-tap', 'vquiz'); q.setAttribute('data-item', VID); t.taps.push(q);
    t.root.querySelector = (sel) => (sel === '.wq-vid' ? vEl : sel === '.wq-after' ? (after.gone ? null : after) : null);
    let mounted = 0;
    t.W.WQFC = { mount: () => { mounted += 1; return true; } };
    const go = jest.fn();
    const B = { ...F.boot(lang, SHELF()), card_v3: true };
    t.W.WQDOORS.mount(t.root, B, { token: TOKEN, lang, ev() {}, go }, `watch/${VID}`);
    await flush();
    const drawn = t.root.innerHTML;
    expect(drawn).toMatch(/data-tap="vquiz"/);
    vEl.fire('ended');
    expect(mounted).toBe(1);
    expect(after.gone).toBe(true);
    // what the end card leaves: the screen without its .wq-after block still holds the Quiz button
    const left = drawn.replace(/<div class="wq-after"[\s\S]*$/, '');
    expect(left).toMatch(/<button class="wq-btn wq-btn--secondary wq-vquiz" type="button" data-tap="vquiz" data-item="aaaaaaa1/);
    q.fire('click');
    await flush();
    expect(go).toHaveBeenCalledWith('/q/WAT001?k=kw&to=q', 'door_quiz');
  });
});

describe('a subject that does not load never leaves placeholders up (switch on)', () => {
  test.each(['en', 'ur'])('%s: the failed shelf shows the oops line and one Try again; the tap reloads just that shelf', async (lang) => {
    let maths = 0;
    const t = live((url) => (/[?&]s=Maths/.test(url) ? ((maths += 1) === 1 ? FAIL : { ...CH, subject: 'Maths' }) : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    const retry = el(); retry.setAttribute('data-tap', 'vretry'); retry.setAttribute('data-item', 'Maths'); retry.setAttribute('data-pos', '1');
    t.shelves.Maths = el({ querySelectorAll: (sel) => (sel === '[data-tap]' ? [retry] : []) });
    t.W.WQDOORS.mount(t.root, F.boot(lang, SHELF()), { token: TOKEN, lang, ev() {}, go: jest.fn() }, 'videos');
    await flush();
    const failed = t.shelves.Maths.innerHTML;
    expect(failed).not.toMatch(/wq-vskel/);
    expect(failed).toContain(lang === 'ur' ? 'اوہو! یہ نہیں کھل سکا۔' : 'This did not load.');
    expect(count(failed, /<button class="wq-btn wq-btn--secondary[^"]*" type="button" data-tap="vretry" data-item="Maths"/g)).toBe(1);
    expect(t.shelves.Science.innerHTML).toMatch(/class="wq-vcard"/);
    retry.fire('click');
    await flush();
    expect(maths).toBe(2);
    expect(t.shelves.Maths.innerHTML).toMatch(/class="wq-vcard"/);
    expect(t.shelves.Maths.innerHTML).not.toMatch(/vretry|wq-vskel/);
  });
  test('a subject opened (See all) that does not load: the oops line and Try again, never "No videos here yet"', async () => {
    const t = live((url) => (/[?&]s=Science/.test(url) ? FAIL : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    const B = F.boot('en', SHELF());
    const ctx = { token: TOKEN, lang: 'en', ev() {}, go: jest.fn() };
    const all = el(); all.setAttribute('data-tap', 'subj'); all.setAttribute('data-item', 'Science');
    t.taps.push(all);
    t.W.WQDOORS.mount(t.root, B, ctx, 'videos');
    await flush();
    all.fire('click');
    await flush();
    expect(t.root.innerHTML).toContain('This did not load.');
    expect(t.root.innerHTML).not.toContain('No videos here yet.');
    expect(t.root.innerHTML).toMatch(/data-tap="vretry" data-item="Science"/);
  });
});

describe('the watch screen while its lesson loads (switch on)', () => {
  test.each(['en', 'ur'])('%s: a placeholder player, never "Opening the video…", one primary', (lang) => {
    const W = F.load();
    const h = W.WQDOORS.html(F.boot(lang, SHELF()), { token: TOKEN, lang }, `watch/${VID}`, null);
    expect(h).not.toContain(lang === 'ur' ? 'ویڈیو کھل رہی ہے…' : 'Opening the video…');
    expect(h).toMatch(/class="wq-vbox wq-vskel"[^>]*aria-busy="true"/);
    expect(count(h, /data-primary/g)).toBe(1);
  });
});

// The list-state contract every child list writes on its root: data-fetch pending|done|failed, when its placeholders
// came and went (data-skel-from / data-skel-to), and when a true empty showed (data-empty-at, never while pending).
describe('the Videos lists say their state on the door root (switch on)', () => {
  const ctxOf = (lang = 'en') => ({ token: TOKEN, lang, ev() {}, go: jest.fn() });
  test('subjects loading, then every shelf filled: pending with its placeholder start, then done with its end; no empty', async () => {
    const t = live((url) => (/[?&]s=Maths/.test(url) ? { ...CH, subject: 'Maths' } : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), ctxOf(), 'videos');
    expect(t.root.attrs['data-fetch']).toBe('pending');
    expect(t.root.attrs['data-skel-from']).toMatch(/^\d+$/);
    expect(t.root.attrs['data-skel-to']).toBeUndefined();
    await flush();
    expect(t.root.attrs['data-fetch']).toBe('done');
    expect(Number(t.root.attrs['data-skel-to'])).toBeGreaterThanOrEqual(Number(t.root.attrs['data-skel-from']));
    expect(t.root.attrs['data-empty-at']).toBeUndefined();
    expect(t.shelves.Science.attrs['data-fetch']).toBe('done');
    expect(t.shelves.Maths.attrs['data-fetch']).toBe('done');
  });
  test('the subjects in, one shelf still loading: the root still says pending', async () => {
    let hold;
    const t = live((url) => (/[?&]s=Maths/.test(url) ? new Promise((r) => { hold = r; }) : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), ctxOf(), 'videos');
    await flush();
    expect(t.shelves.Science.attrs['data-fetch']).toBe('done');
    expect(t.shelves.Maths.attrs['data-fetch']).toBe('pending');
    expect(t.root.attrs['data-fetch']).toBe('pending');
    hold({ ...CH, subject: 'Maths' });
    await flush();
    expect(t.root.attrs['data-fetch']).toBe('done');
  });
  test('a shelf that fails: failed, with its Try again present; the tap makes it pending, then done', async () => {
    let maths = 0;
    const t = live((url) => (/[?&]s=Maths/.test(url) ? ((maths += 1) === 1 ? FAIL : { ...CH, subject: 'Maths' }) : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    const retry = el(); retry.setAttribute('data-tap', 'vretry'); retry.setAttribute('data-item', 'Maths'); retry.setAttribute('data-pos', '1');
    t.shelves.Maths = el({ querySelectorAll: (sel) => (sel === '[data-tap]' ? [retry] : []) });
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), ctxOf(), 'videos');
    await flush();
    expect(t.shelves.Maths.attrs['data-fetch']).toBe('failed');
    expect(t.root.attrs['data-fetch']).toBe('failed');
    expect(t.shelves.Maths.innerHTML).toMatch(/data-tap="vretry"/);
    retry.fire('click');
    expect(t.root.attrs['data-fetch']).toBe('pending');
    await flush();
    expect(t.root.attrs['data-fetch']).toBe('done');
  });
  test.each(['en', 'ur'])('%s: the subjects list that fails: failed, the shelves\' own Try again (one primary, no old retry); the tap makes it pending, then done', async (lang) => {
    let subs = 0;
    const t = live((url) => (/[?&]s=Maths/.test(url) ? { ...CH, subject: 'Maths' } : /[?&]s=/.test(url) ? CH : ((subs += 1) === 1 ? FAIL : LIB_SUBJECTS)));
    const retry = el(); retry.setAttribute('data-tap', 'vretry');
    t.taps.push(retry);                 // the failed screen's Try again, wired when that screen is drawn
    t.W.WQDOORS.mount(t.root, F.boot(lang, SHELF()), ctxOf(lang), 'videos');
    await flush();
    expect(t.root.attrs['data-fetch']).toBe('failed');
    expect(count(t.root.innerHTML, /<button class="wq-btn wq-btn--secondary wq-vretry" type="button" data-primary data-tap="vretry"/g)).toBe(1);
    expect(t.root.innerHTML).not.toMatch(/data-tap="retry"|wq-go/);
    expect(count(t.root.innerHTML, /data-primary/g)).toBe(1);
    expect(t.root.attrs['data-empty-at']).toBeUndefined();
    retry.fire('click');
    expect(t.root.attrs['data-fetch']).toBe('pending');
    await flush();
    expect(t.root.attrs['data-fetch']).toBe('done');
    expect(t.shelves.Science.attrs['data-fetch']).toBe('done');
    expect(t.root.attrs['data-empty-at']).toBeUndefined();
  });
  test('a subject whose chapters hold no lessons: its shelf is taken away, the rest say done, and that is not an empty screen', async () => {
    const none = { ...CH, subject: 'Maths', chapters: CH.chapters.map((c) => ({ ...c, videos: [] })) };
    const t = live((url) => (/[?&]s=Maths/.test(url) ? none : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
    const sec = el(); const row = el(); row.parentNode = sec; sec.parentNode = el({ removeChild: jest.fn() });
    t.shelves.Maths = row;
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), ctxOf(), 'videos');
    await flush();
    expect(sec.parentNode.removeChild).toHaveBeenCalledWith(sec);
    expect(t.shelves.Science.attrs['data-fetch']).toBe('done');
    expect(t.root.attrs['data-fetch']).toBe('done');
    expect(t.root.attrs['data-empty-at']).toBeUndefined();
  });
  test('no subjects at all (a true empty): done, and the empty moment is stamped', async () => {
    const t = live(() => ({ ...LIB_SUBJECTS, subjects: [] }));
    t.W.WQDOORS.mount(t.root, F.boot('en', SHELF()), ctxOf(), 'videos');
    expect(t.root.attrs['data-empty-at']).toBeUndefined();
    await flush();
    expect(t.root.attrs['data-fetch']).toBe('done');
    expect(t.root.attrs['data-empty-at']).toMatch(/^\d+$/);
  });
  test.each(['en', 'ur'])('%s: See all that fails says failed; its Try again reloads the subject, and the grid then says done', async (lang) => {
    let back = false;                   // Science fails until the child taps Try again
    const t = live((url) => (/[?&]s=Science/.test(url) ? (back ? CH : FAIL) : /[?&]s=/.test(url) ? { ...CH, subject: 'Maths' } : LIB_SUBJECTS));
    const ctx = ctxOf(lang);
    const all = el(); all.setAttribute('data-tap', 'subj'); all.setAttribute('data-item', 'Science');
    t.taps.push(all);
    t.W.WQDOORS.mount(t.root, F.boot(lang, SHELF()), ctx, 'videos');
    await flush();
    const retry = el(); retry.setAttribute('data-tap', 'vretry'); retry.setAttribute('data-item', 'Science');
    all.fire('click');
    t.taps.push(retry);                 // the failed grid's Try again, wired when that screen is drawn
    expect(t.root.attrs['data-fetch']).toBe('pending');
    await flush();
    expect(t.root.attrs['data-fetch']).toBe('failed');
    expect(t.root.innerHTML).toMatch(/data-tap="vretry" data-item="Science"/);
    back = true;
    retry.fire('click');
    expect(t.root.attrs['data-fetch']).toBe('pending');
    await flush();
    expect(t.root.innerHTML).toMatch(/class="wq-vgrid"/);
    expect(t.root.innerHTML).not.toMatch(/vretry/);
    expect(t.root.attrs['data-fetch']).toBe('done');
  });
});
