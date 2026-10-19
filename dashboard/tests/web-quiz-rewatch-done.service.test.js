/**
 * A finished lesson's picture plays the lesson again (app_settings web_quiz_rewatch_done; the bot names it on the hub
 * boot as `rewatch_done: true`). On: tapping the picture of a lesson whose quiz the child finished opens its page as a
 * fresh go (again=1): the video first, then the questions as "Play again", never the old finish card. An unfinished
 * lesson and the Quiz button are as today. Off: every link is today's, byte for byte. Invented children only.
 */
const F = require('./web-quiz-video-shelf.fixture');
const { page, flush: pflush } = require('./wq-page-harness');

const { TOKEN, KID, VID, VID2, LIB_SUBJECTS, LIB_CHAPTERS } = F;
const VID3 = 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHELF = { href: '/lib/x', shelf: true };
// a class child's subject: one lesson finished (its quiz code and the child's key), one not, one with no code yet
const CH = { ...LIB_CHAPTERS, quiz: true, chapters: [{ ...LIB_CHAPTERS.chapters[0], videos: [
  { vid: VID3, title: 'Words That Describe Nouns', secs: 120, done: true, code: 'ENG003', k: 'kk3', poster: 'https://r2.example.test/p3_poster.jpg?sig' },
  LIB_CHAPTERS.chapters[0].videos[1],
  LIB_CHAPTERS.chapters[0].videos[0],
] }] };
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

// The Videos door with a subject's shelf in, then one picture tapped: where the page goes (go) and what was asked.
async function tapPicture(vid, { on, lang = 'en', start = null } = {}) {
  const t = live((url) => (/videos\/start/.test(url) ? start : /[?&]s=/.test(url) ? CH : LIB_SUBJECTS));
  const go = jest.fn();
  const B = { ...F.boot(lang, SHELF), ...(on ? { rewatch_done: true } : {}) };
  t.W.WQDOORS.mount(t.root, B, { token: TOKEN, lang, ev() {}, go }, 'videos');
  await flush();
  const p = el(); p.setAttribute('data-tap', 'vid'); p.setAttribute('data-item', vid);
  t.taps.push(p);
  t.W.WQDOORS.mount(t.root, B, { token: TOKEN, lang, ev() {}, go }, 'videos');
  await flush();
  p.fire('click');
  await flush();
  return { go, posts: t.fetch.mock.calls.filter(([u]) => /videos\/start/.test(u)).map(([, o]) => JSON.parse(o.body)) };
}

describe('the Videos door: a finished lesson\'s picture', () => {
  test.each(['en', 'ur'])('%s, switch on: the lesson page as a fresh go (again=1), the video first; nothing minted', async (lang) => {
    const { go, posts } = await tapPicture(VID3, { on: true, lang });
    expect(go).toHaveBeenCalledWith('/q/ENG003?k=kk3&via=videos&again=1', 'door_video');
    expect(posts).toEqual([]);
  });
  test('switch off: today\'s link, byte for byte (the page lands on the old finish card)', async () => {
    const { go } = await tapPicture(VID3, { on: false });
    expect(go).toHaveBeenCalledWith('/q/ENG003?k=kk3&via=videos', 'door_video');
  });
  test('an unfinished lesson: today\'s link, switch on or off', async () => {
    for (const on of [true, false]) {
      const { go } = await tapPicture(VID2, { on });
      expect(go).toHaveBeenCalledWith('/q/SCI002?k=kk2&via=videos', 'door_video');
    }
  });
  test('a finished lesson with no code yet: the server makes it on the tap; on, its link is a fresh go too; off, today\'s', async () => {
    let r = await tapPicture(VID, { on: true, start: { code: 'SCI001', k: 'kk1' } });
    expect(r.posts).toEqual([{ hub: TOKEN, kid: KID, vid: VID }]);
    expect(r.go).toHaveBeenCalledWith('/q/SCI001?k=kk1&via=videos&again=1', 'door_video');
    r = await tapPicture(VID, { on: false, start: { code: 'SCI001', k: 'kk1' } });
    expect(r.go).toHaveBeenCalledWith('/q/SCI001?k=kk1&via=videos', 'door_video');
  });
  test('a child with no class (the watch answer): the watch screen as today, switch on', async () => {
    const r = await tapPicture(VID, { on: true, start: { watch: { ...F.WATCH } } });
    expect(r.go).not.toHaveBeenCalled();
  });
});

describe('the lesson page the link opens (wq.js, unchanged): again=1 plays the video, not the old card', () => {
  const CHILD = { first: 'Zara', chip: 'kk3', animal: 'owl' };
  const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, score: { correct: 3, total: 5 } };
  const store = { wq_s_TEST: { st: 's1', child: CHILD, answers: { q1: { slot: 'A', ok: true } }, queue: [], result: RESULT }, wq_kids: [CHILD] };
  const open = async (search, lang) => {
    const p = page({ lang, store, search, ident: true, video: { url: 'https://r2.example.test/v3_web.mp4?sig' }, bootExtra: { videos_v3: true, cls: { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2' } } },
      api: { '/session': { st: 's2', child: CHILD, counted: false, reason: 'already_finished' } } });
    await pflush(); await pflush();
    return p;
  };
  test.each(['en', 'ur'])('%s: today\'s link lands on the finish card; again=1 opens the video first', async (lang) => {
    expect((await open('?k=kk3&via=videos', lang)).moment()).toBe('M10');
    const p = await open('?k=kk3&via=videos&again=1', lang);
    expect(p.moment()).toBe('M5');
    expect(p.html()).toContain('v3_web.mp4');
  });
});
