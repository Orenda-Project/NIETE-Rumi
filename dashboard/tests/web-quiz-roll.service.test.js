/**
 * Web quiz page, "who is playing?" with a class list (public/wq/wq.js M4 + E3 startSession).
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
    S: { answers: {}, queue: [] }, ROOT,
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
    ev: (n, p) => events.push({ n, p }), toast: () => {}, landing: () => screens.push({ name: 'M3', h: '' }),
    video: () => {}, nextQuestion: () => screens.push({ name: 'Q', h: '' }),
    api: (m, route, body) => { calls.push(body); return Promise.resolve(replies.shift()); },
  };
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.who = who;`, ctx);
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

test('the M4 + E3 blocks are still where this test cuts them from', () => {
  expect(START).toBeGreaterThan(0);
  expect(END).toBeGreaterThan(START);
});

test('a class list: "who is playing?" is a roll-number pad, with no class name chips', () => {
  const p = page();
  p.ctx.who();
  expect(p.last().name).toBe('M4-roll');
  expect(p.last().h).toContain('What is your roll number?');
  expect(p.last().h).not.toContain('wq-kid');
  expect(p.last().h).toMatch(/data-k="go" disabled/);
});

test('typing 1 2 then Go asks the server for roll 12; the answer is "Are you Danish?" and Yes plays as that child', async () => {
  const cand = { chip: 'c12', first: 'Danish', animal: 'owl' };
  const p = page({ replies: [
    { status: 409, ok: false, body: { error: 'is_this_you', candidates: [cand] } },
    { status: 200, ok: true, body: { st: 'st1', device_ref: 'd', counted: true, child: cand, resume: { answered: [] } } },
  ] });
  p.ctx.who();
  p.key('1'); p.key('2');
  expect(p.last().h).toContain('>12<');
  p.key('go');
  await flush();
  expect(p.calls[0]).toMatchObject({ code: 'AB12CD', roll: '12' });
  expect(p.last().name).toBe('M4-isyou');
  expect(p.last().h).toContain('Are you Danish?');
  expect(p.last().h).toContain('No, try again');
  p.tap((n) => n.a['data-chip'] === 'c12');
  await flush();
  expect(p.calls[1]).toMatchObject({ chip: 'c12', via: 'roll' });
  expect(p.events.map((e) => e.p && e.p.src)).toEqual(expect.arrayContaining(['roll_try', 'roll']));
});

test('"No, try again" goes back to an empty pad', async () => {
  const p = page({ replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'c', first: 'Danish', animal: 'owl' }] } }] });
  p.ctx.who();
  p.key('4'); p.key('go');
  await flush();
  p.byId['#wq-diff']();
  expect(p.last().name).toBe('M4-roll');
  expect(p.last().h).toMatch(/data-k="go" disabled/);
});

test('an unknown roll number: the pad again, the mascot says no one has that number', async () => {
  const p = page({ replies: [{ status: 404, ok: false, body: { error: 'roll_unknown' } }] });
  p.ctx.who();
  p.key('3'); p.key('1'); p.key('go');
  await flush();
  expect(p.last().name).toBe('M4-roll');
  expect(p.last().h).toContain('No one in this class has number 31. Try again!');
});

test('the pad takes at most 3 digits, never a leading 0, and Delete removes one', () => {
  const p = page();
  p.ctx.who();
  ['0', '1', '2', '3', '4'].forEach(p.key);
  expect(p.last().h).toContain('>123<');
  p.key('del');
  expect(p.last().h).toContain('>12<');
});

test('two classes: each card carries its class label; the way out says "None of these is me"', async () => {
  const p = page({ replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [
    { chip: 'a', first: 'Ayesha', animal: 'owl', cls: '3-B' }, { chip: 'b', first: 'Faizan', animal: 'cat', cls: '4-A' }] } }] });
  p.ctx.who();
  p.key('1'); p.key('go');
  await flush();
  expect(p.last().h).toContain('3-B');
  expect(p.last().h).toContain('4-A');
  expect(p.last().h).toContain('None of these is me');
});

test("I don't know my number: the name box", () => {
  const p = page();
  p.ctx.who();
  p.byId['#wq-noroll']();
  expect(p.last().name).toBe('M4-new');
});

test('Urdu: Urdu digits on the keys and in the "no one has number" line', async () => {
  const p = page({ lang: 'ur', replies: [{ status: 404, ok: false, body: { error: 'roll_unknown' } }] });
  p.ctx.who();
  expect(p.last().h).toContain('آپ کا رول نمبر کیا ہے؟');
  expect(p.last().h).toContain('>۷<');
  p.key('3'); p.key('1'); p.key('go');
  await flush();
  expect(p.last().h).toContain('نمبر ۳۱ کسی کا نہیں');
});

test('Urdu: a class label like 3-B is an LTR isolate, so it never paints as B-3', async () => {
  const p = page({ lang: 'ur', replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [
    { chip: 'a', first: 'x', animal: 'owl', cls: '3-B' }, { chip: 'b', first: 'y', animal: 'cat', cls: '4-A' }] } }] });
  p.ctx.who();
  p.key('1'); p.key('go');
  await flush();
  expect(p.last().h).toContain('<bdi dir="ltr">3-B</bdi>');
});

test('no class list: the name chips as today', () => {
  const p = page({ cls: { chips: [{ chip: 'z', first: 'Zara', animal: 'owl' }] } });
  p.ctx.who();
  expect(p.last().name).toBe('M4');
  expect(p.last().h).toContain('Zara');
});

test("the pad's Go key reads at AA contrast: the same text colour as the page's main green button", () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
  const rule = (sel) => (css.match(new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\{([^}]*)\\}`)) || [])[2] || '';
  const goColor = (rule('.wq-go').match(/(?:^|;)color:([^;]+)/) || [])[1];
  expect(goColor).toBeTruthy();
  expect((rule('.wq-key-go').match(/(?:^|;)color:([^;]+)/) || [])[1]).toBe(goColor);
});
