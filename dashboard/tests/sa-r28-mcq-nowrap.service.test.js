'use strict';
/**
 * Round 28 (switch sa_r28_mcq): on a phone an Urdu MCQ question or answer must not wrap inside a word run a teacher
 * reads as one unit, e.g. «دریائے | جہلم». The engine keeps an explicit list of such runs (no suffix rule: a rule like
 * "a word ending in «ئے» joins the next" would also glue verbs such as «گئے»). On the MCQ screen each listed run sits in
 * ONE white-space:nowrap wrapper. The words, their order, the shown text and so the clip key (sha1(lang|text)) are
 * unchanged; the passage and every other screen are untouched.
 *
 * Fixtures: the served Urdu coach battery's own MCQ items (bot/shared/data/child-test/sa), with their clips moved to
 * v4 as the battery route does under sa_voice_v4, and the committed v4 timing file of the question.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  try { ({ JSDOM } = require(path.join(__dirname, '../../portal/node_modules/jsdom'))); } catch (__) { /* not installed here */ }
}
const maybe = JSDOM ? describe : describe.skip;

const SA = path.join(__dirname, '..', 'sa');
const BATTERY = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', 'sa.coach.G3.A.ur.json');
const served = JSON.parse(fs.readFileSync(BATTERY, 'utf8'));
const mcqServed = served.tasks.find((t) => t.id === 'ur.story_mcq_w3');
const storyServed = served.tasks.find((t) => t.id === 'ur.story_w3');
const allItems = [].concat(mcqServed.items, ...(mcqServed.variants || []).map((v) => v.items || []));
const itemOf = (id, pred) => allItems.find((x) => x.id === id && (!pred || pred(x)));
const Q1 = itemOf('ur.story_w3.q1');
const Q4 = itemOf('ur.story_w3.q4', (x) => x.options.includes('رنگ برنگے پھول'));
const S2Q5 = itemOf('ur.story2.q5');
const v4 = (k) => String(k).replace(/(^|\/)sa\/v1\/(en|ur)\//, '$1sa/v4/$2/');
const toV4 = (it) => Object.assign(JSON.parse(JSON.stringify(it)), { prompt: { text: it.prompt.text, audio: v4(it.prompt.audio) } });
const words = (s) => String(s).split(/\s+/).filter(Boolean);
const clipKey = (lang, text) => crypto.createHash('sha1').update(lang + '|' + text).digest('hex').slice(0, 12);

maybe('sa_r28_mcq: listed Urdu word runs stay on one line on the MCQ screen', () => {
  let dom;
  const keep = {};
  let views = [];
  function setup() {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'fetch']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  }
  afterEach(() => {
    views.forEach((v) => v.destroy()); views = [];
    for (const k of Object.keys(keep)) global[k] = keep[k];
    if (dom) dom.window.close();
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** fetch stub: the committed v4 timing files, from disk; anything else 404. */
  function fetcher() {
    const asked = [];
    const f = (url) => {
      asked.push(url);
      const m = /\/sa\/(v4\/(?:ur|en)\/[0-9a-f]{12}\.json)$/.exec(String(url));
      const file = m ? path.join(SA, m[1]) : null;
      if (!file || !fs.existsSync(file)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      const body = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    };
    global.fetch = f; dom.window.fetch = f;
    return asked;
  }
  /** A voice whose lines end when the test says so; speak.audio() is the line's stub <audio> (src under the CDN). */
  function fakeVoice() {
    const lines = [];
    let cur = null;
    const speak = (textObj, audioObj) => {
      if (cur) cur.resolve();
      const a = new dom.window.EventTarget();
      const key = typeof audioObj === 'string' ? audioObj : (textObj && textObj.audio) || '';
      a.paused = true; a.currentTime = 0; a.ended = false; a.src = 'https://cdn.test/' + key;
      const line = { textObj, audioObj, key, a, done: false };
      const p = new Promise((res) => { line.resolve = () => { if (!line.done) { line.done = true; if (cur === line) cur = null; res(); } }; });
      lines.push(line); cur = line;
      return p;
    };
    speak.audio = () => (cur ? cur.a : null);
    async function next() {
      for (let i = 0; i < 200 && !lines.find((l) => !l.done && !l.played); i++) await wait(10);
      const l = lines.find((x) => !x.done && !x.played);
      if (!l) throw new Error('no line asked');
      l.played = true; l.a.paused = false; l.a.currentTime = 0.01; l.a.dispatchEvent(new dom.window.Event('playing'));
      return l;
    }
    function end(l) { l.a.currentTime = 2.4; l.a.paused = true; l.a.ended = true; l.a.dispatchEvent(new dom.window.Event('ended')); l.resolve(); }
    return { speak, lines, next, end };
  }
  function mount(items, o) {
    o = o || {};
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const task = Object.assign({}, mcqServed, { items, variants: undefined, practice: undefined, depends_on: null });
    const battery = { battery_id: 'b', lines: {}, tasks: [task], ui: Object.assign({ r28_mcq: o.on !== false, r8_highlight: true }, o.ui || {}) };
    const runner = core.createRunner(Object.assign({ battery, onEvent: () => {} }, o.manual ? { manual: true } : {}));
    const voice = fakeVoice();
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'ur', mode: 'proctored', handover: false, speak: voice.speak,
      r28: { letter_pick: false, mcq: o.on !== false, ceiling: false } }, o.manual ? { manual: true } : {}));
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); view.render();
    return { el, voice, runner };
  }
  const wraps = (node) => Array.from(node.querySelectorAll('.sae-nowrap'));
  const isNowrap = (n) => n.style.whiteSpace === 'nowrap' || dom.window.getComputedStyle(n).whiteSpace === 'nowrap';
  /** The question's state: its wrappers, its words, and any highlight word spans in it. */
  function look(el) {
    const q = el.querySelector('.sae-mcq-q');
    return { q, wraps: wraps(q), words: words(q.textContent), hl: Array.from(q.querySelectorAll('.sae-r8-w')) };
  }
  function oneRun(w, run) {
    expect(w.textContent).toBe(run.join(' '));
    expect(isNowrap(w)).toBe(true);
    expect(w.textContent).not.toMatch(/ /);
  }

  test('the question «… دریائے جہلم گیا؟» with its v4 timing file: the pair in one nowrap wrapper before the first highlight and after the highlight has reached «جہلم»', async () => {
    setup();
    const asked = fetcher();
    const it = toV4(Q1);
    expect(fs.existsSync(path.join(SA, 'v4', 'ur', '9ab9e3a1167b.json'))).toBe(true);
    const { el, voice } = mount([it]);
    await wait(20);
    let s = look(el);
    expect(s.wraps).toHaveLength(1);
    oneRun(s.wraps[0], ['دریائے', 'جہلم']);
    expect(s.words).toEqual(words(Q1.prompt.text));
    // Jugnu reads the question: the clip is the served key, played past «جہلم» (s_ms 1650 in the timing file)
    const ql = await voice.next();
    expect(ql.key).toBe(it.prompt.audio);
    await wait(60);
    ql.a.currentTime = 1.8;
    await wait(120);
    s = look(el);
    expect(s.wraps).toHaveLength(1);
    oneRun(s.wraps[0], ['دریائے', 'جہلم']);
    expect(s.words).toEqual(words(Q1.prompt.text));
    // a highlight that rebuilds the line as word spans keeps one span per word, in order, the pair inside the wrapper
    if (s.hl.length) {
      expect(s.hl.map((x) => x.textContent)).toEqual(words(Q1.prompt.text));
      expect(s.hl[4].parentNode).toBe(s.wraps[0]);
      expect(s.hl[5].parentNode).toBe(s.wraps[0]);
    }
    voice.end(ql);
    await wait(20);
    expect(asked.every((u) => !/\.mp3$/.test(u))).toBe(true);
  }, 20000);

  test('an answer holding a listed run gets the wrapper: «رنگ برنگے پھول», and «وقت پر دانہ پانی دے کر» under «جانور /پرندوں»', async () => {
    setup();
    fetcher();
    const { el } = mount([toV4(Q4), toV4(S2Q5)]);
    await wait(20);
    const inks = Array.from(el.querySelectorAll('.sae-mcq-opt .sae-mcq-ink'));
    expect(inks.map((x) => x.textContent)).toEqual(Q4.options);
    const k = Q4.options.indexOf('رنگ برنگے پھول');
    expect(wraps(inks[k])).toHaveLength(1);
    oneRun(wraps(inks[k])[0], ['رنگ', 'برنگے']);
    inks.forEach((x, i) => { if (i !== k) expect(wraps(x)).toHaveLength(0); });
    // the other item: the slash token stays with «جانور» (it must not start a line), and «دانہ پانی» in its answer
    const r = mount([toV4(S2Q5)]);
    await wait(20);
    const q = look(r.el);
    expect(q.wraps).toHaveLength(1);
    oneRun(q.wraps[0], ['جانور', '/پرندوں']);
    const inks2 = Array.from(r.el.querySelectorAll('.sae-mcq-opt .sae-mcq-ink'));
    const k2 = S2Q5.options.indexOf('وقت پر دانہ پانی دے کر');
    expect(wraps(inks2[k2])).toHaveLength(1);
    oneRun(wraps(inks2[k2])[0], ['دانہ', 'پانی']);
  }, 20000);

  test('coach-led: the fold\'s question and answers keep the same runs', async () => {
    setup();
    fetcher();
    const { el } = mount([toV4(S2Q5)], { manual: true });
    await wait(20);
    const fold = el.querySelector('.sae-mcq-coach');
    expect(fold).not.toBeNull();
    const line = fold.querySelector('.sae-coach-line');
    expect(line.textContent).toBe(S2Q5.prompt.text);
    expect(wraps(line)).toHaveLength(1);
    oneRun(wraps(line)[0], ['جانور', '/پرندوں']);
    const lis = Array.from(fold.querySelectorAll('.sae-mcq-coach-opts li'));
    expect(lis.map((x) => x.textContent)).toEqual(S2Q5.options);
    expect(lis.reduce((n, x) => n + wraps(x).length, 0)).toBe(1);
  }, 20000);

  test('a pair not on the list gets no wrapper: «گئے» and the word after it, and every other neighbour pair', async () => {
    setup();
    fetcher();
    const synth = Object.assign(toV4(Q1), { id: 'ur.story_w3.q9', options: ['وہ گئے گھر', 'دریائے کنارے', 'جہلم دریائے', 'ٹَیں'] });
    const { el } = mount([synth]);
    await wait(20);
    const inks = Array.from(el.querySelectorAll('.sae-mcq-opt .sae-mcq-ink'));
    expect(inks.map((x) => x.textContent)).toEqual(synth.options);
    inks.forEach((x) => expect(wraps(x)).toHaveLength(0));
    expect(look(el).wraps).toHaveLength(1); // only «دریائے جہلم» in «بلال کس کے ساتھ دریائے جہلم گیا؟»
  }, 20000);

  test('the shown text and the clip key are the served ones, byte for byte; no U+00A0 anywhere', async () => {
    setup();
    fetcher();
    const it = toV4(Q1);
    const { el, voice } = mount([it]);
    await wait(20);
    const q = el.querySelector('.sae-mcq-q');
    expect(q.textContent).toBe(Q1.prompt.text);
    expect(Array.from(el.querySelectorAll('.sae-mcq-opt .sae-mcq-ink')).map((x) => x.textContent)).toEqual(Q1.options);
    expect(el.innerHTML).not.toMatch(/ |&nbsp;/);
    const ql = await voice.next();
    expect(ql.key).toBe('sa/v4/ur/' + clipKey('ur', q.textContent) + '.mp3');
    expect(Q1.prompt.audio).toBe('sa/v1/ur/' + clipKey('ur', Q1.prompt.text) + '.mp3');
  }, 20000);

  test('the switch OFF: the same item draws as before, no wrapper', async () => {
    setup();
    fetcher();
    const { el } = mount([toV4(Q1)], { on: false });
    await wait(20);
    expect(el.querySelector('.sae-mcq-q')).toBeNull();
    expect(wraps(el)).toHaveLength(0);
  }, 20000);

  test('the switch ON: the story passage that holds «دریائے جہلم» is untouched (no wrapper, its word tokens as served)', async () => {
    setup();
    fetcher();
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', lines: {}, tasks: [Object.assign({}, storyServed)], ui: { r28_mcq: true, r8_highlight: true } };
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'ok' });
    const voice = fakeVoice();
    const el = document.getElementById('m');
    views.push(ui.mount(el, { runner, battery, lang: 'ur', mode: 'proctored', handover: false, speak: voice.speak, r28: { letter_pick: false, mcq: true, ceiling: false } }));
    runner.start(); runner.instructionDone(); runner.begin(); views[0].render();
    await wait(20);
    const toks = words(storyServed.passage.text);
    expect(toks.slice(6, 8)).toEqual(['دریائے', 'جہلم']);
    expect(storyServed.items.slice(6, 8).map((x) => x.target)).toEqual(['دریائے', 'جہلم']);
    expect(el.textContent).toContain('دریائے جہلم');
    expect(wraps(el)).toHaveLength(0);
  }, 20000);
});
