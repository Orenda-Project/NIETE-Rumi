/**
 * Web quiz page, the teacher's "Who played?" on their own preview link (public/wq/wq.js M4).
 *
 * When the teacher keeps a class list the payload says cls.roster and carries no
 * classmates' names; the page asks for a roll number on a number pad, the server
 * answers "is_this_you" with a first name + animal, and the child confirms. Runs
 * the page's own M4 + E3 blocks, cut from the shipped file, in a vm; the DOM and
 * the network (api) are the faked boundaries.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(process.env.WQ_SRC || path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf("  /* ---------------- M4 who's playing");
const END = SRC.indexOf('  /* ---------------- M5 video');

function attrs(tag) {
  const out = {};
  tag.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { out[k] = v; });
  if (/\sdisabled[\s>]/.test(tag)) out.disabled = '';
  return out;
}

function page({ lang = 'en', cls = { roster: { lists: 1 }, chips: [] }, kids = [], replies = [] } = {}) {
  const screens = [];
  const calls = [];
  const events = [];
  let handlers = [];
  const el = (tag) => {
    const a = attrs(tag);
    const node = { a, getAttribute: (k) => (k in a ? a[k] : null), value: '', focus() {}, listeners: {},
      addEventListener(n, fn) { this.listeners[n] = fn; handlers.push(node); } };
    return node;
  };
  const nodes = () => (screens[screens.length - 1].h.match(/<(button|input|div)\b[^>]*>/g) || []).map(el);
  const ROOT = {
    querySelectorAll(sel) {
      const all = nodes();
      if (sel === '.wq-kid') return all.filter((n) => /\bwq-kid\b/.test(n.a.class || ''));
      const m = sel.match(/^\[([\w-]+)\]$/);
      if (m) return all.filter((n) => m[1] in n.a);
      return [];
    },
  };
  const byId = {};
  const ctx = {
    LANG: lang, CLS: cls, CLASS_LABEL: 'your class', Q: { grade: '3' }, QS: [], B: {}, params: {}, CODE: 'AB12CD',
    S: { answers: {}, queue: [] }, ROOT, toastSeen: [],
    T: { whoT: 'Whose turn is it?', whoSay: 'Tap your name.', onPhone: 'On this phone', inClass: (c) => `Find your name in ${c}`,
      newKid: "I'm new", back: 'Back', newT: 'First name?', newSay: 'x', privacy: 'p', start: 'Start',
      isYou: (n) => `Are you ${n}?`, isYouSub: 'Tap Yes only if this is your own name.', yesMe: "Yes, it's me", diff: (n) => `I'm a different ${n}`,
      oops: 'oops', offline: 'offline' },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    ani: (a) => `[${a}]`, bar: () => '', jug: (m, say) => `<p class="jug">${say}</p>`, wireBar: () => {},
    render: (h, name) => { screens.push({ h, name }); handlers = []; },
    on: (sel, fn) => { byId[sel] = fn; },
    $: () => ({ value: '', focus() {}, addEventListener() {} }),
    kids: () => kids, rememberKid: () => {}, save: () => {}, sget: () => null, sset: () => {},
    ev: (n, p) => events.push({ n, p }), toast: (t) => ctx.toastSeen.push(t), landing: () => screens.push({ name: 'M3', h: '' }),
    video: () => {}, nextQuestion: () => screens.push({ name: 'Q', h: '' }),
    api: (m, route, body) => { calls.push({ route, ...body }); return Promise.resolve(replies.shift()); },
  };
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.who = who; this.whoPlayed = typeof whoPlayed === 'function' ? whoPlayed : null;`, ctx);
  const last = () => screens[screens.length - 1];
  const tap = (pred) => {
    const n = nodes().find(pred);
    if (!n) throw new Error(`nothing to tap on ${last().name}`);
    // re-wire: the screen code adds listeners as it renders; find the wired node with the same attributes
    const wired = handlers.find((h) => JSON.stringify(h.a) === JSON.stringify(n.a));
    wired.listeners.click();
  };
  const key = (k) => tap((n) => n.a['data-k'] === k);
  return { ctx, screens, calls, events, last, tap, key, byId };
}
const flush = () => new Promise((r) => setImmediate(r));
const ok = (body) => ({ status: 200, ok: true, body });


test('the teacher sees who played: off-list children first, first name + roll only, a fix button on off-list rows', async () => {
  const p = page({ replies: [ok({ roster: true, rows: [
    { ref: 's2', first: 'Dansh', roll: null, on_list: false, correct: 3, total: 5 },
    { ref: 's1', first: 'Ayesha', roll: 1, on_list: true, correct: 4, total: 5 }] })] });
  p.ctx.params.p = 'tok';
  p.ctx.whoPlayed();
  await flush();
  expect(p.calls[0]).toMatchObject({ route: 'who', code: 'AB12CD', p: 'tok' });
  const h = p.last().h;
  expect(p.last().name).toBe('M4-who-played');
  expect(h).toContain('Dansh');
  expect(h).toContain('Not on your class list');
  expect(h).toContain('Roll 1');
  expect((h.match(/data-ref=/g) || []).length).toBe(1);
});

test('fixing a row: a roll number, "is this Danish?", Yes moves it and the list reloads', async () => {
  const cand = { chip: 'c12', first: 'Danish', animal: 'owl' };
  const p = page({ replies: [
    ok({ roster: true, rows: [{ ref: 's2', first: 'Dansh', roll: null, on_list: false, correct: 3, total: 5 }] }),
    { status: 409, ok: false, body: { error: 'is_this_you', candidates: [cand] } },
    ok({ ok: true, row: { ref: 's2', first: 'Danish', roll: 12, on_list: true } }),
    ok({ roster: true, rows: [{ ref: 's2', first: 'Danish', roll: 12, on_list: true, correct: 3, total: 5 }] }),
  ] });
  p.ctx.params.p = 'tok';
  p.ctx.whoPlayed();
  await flush();
  p.tap((n) => n.a['data-ref'] === 's2');
  expect(p.last().name).toBe('M4-who-fix');
  expect(p.last().h).toContain('Dansh');
  p.key('1'); p.key('2'); p.key('go');
  await flush();
  expect(p.calls[1]).toMatchObject({ route: 'who/fix', ref: 's2', roll: '12', p: 'tok' });
  expect(p.last().h).toContain('Danish');
  p.tap((n) => n.a['data-chip'] === 'c12');
  await flush(); await flush();
  expect(p.calls[2]).toMatchObject({ route: 'who/fix', ref: 's2', chip: 'c12' });
  expect(p.calls[3]).toMatchObject({ route: 'who' });
  expect(p.last().name).toBe('M4-who-played');
  expect(p.last().h).toContain('Roll 12');
});

test('no class list linked: the list still shows, with no fix buttons, and says why', async () => {
  const p = page({ cls: { chips: [] }, replies: [ok({ roster: false, rows: [{ ref: 's2', first: 'Dansh', roll: null, on_list: false, correct: 3, total: 5 }] })] });
  p.ctx.params.p = 'tok';
  p.ctx.whoPlayed();
  await flush();
  expect(p.last().h).not.toContain('data-ref=');
  expect(p.last().h).toContain('class list');
});
