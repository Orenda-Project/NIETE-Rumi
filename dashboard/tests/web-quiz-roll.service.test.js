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
  vm.runInContext(`${SRC.slice(START, END)}\nthis.who = who; this.startSession = startSession;`, ctx);
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

test('never two green Yes buttons: several candidates are asked about ONE at a time, "No" moves to the next', async () => {
  const p = page({ replies: [{ status: 409, ok: false, body: { error: 'maybe_you', candidates: [
    { chip: 'a', first: 'Ali', animal: 'owl' }, { chip: 'b', first: 'Aly', animal: 'cat' }] } }] });
  p.ctx.who();
  p.byId['#wq-noroll']();
  p.ctx.startSession({ new: { name: 'Ali', cls: '3', force: false } }, null, 'Ali');
  await flush();
  expect(p.last().name).toBe('M4-isyou');
  expect((p.last().h.match(/wq-go/g) || []).length).toBe(1);
  expect(p.last().h).toContain('Are you Ali?');
  expect(p.last().h).not.toContain('Aly');
  expect(p.last().h).toContain(">No, I'm someone else<");
  p.byId['#wq-diff']();
  expect(p.last().h).toContain('Are you Aly?');
  expect((p.last().h.match(/wq-go/g) || []).length).toBe(1);
});

test('after the last "No" on a typed name, the child plays as a new child (force)', async () => {
  const p = page({ replies: [{ status: 409, ok: false, body: { error: 'maybe_you', candidates: [{ chip: 'a', first: 'Ali', animal: 'owl' }] } },
    { status: 200, ok: true, body: { st: 's', counted: true, child: { first: 'Ali' } } }] });
  p.ctx.who();
  p.ctx.startSession({ new: { name: 'Ali', cls: '3', force: false } }, null, 'Ali');
  await flush();
  p.byId['#wq-diff']();
  await flush();
  expect(p.calls[1]).toMatchObject({ new: { name: 'Ali', force: true } });
});

test('a quiz whose class the server cannot tell: "Which class are you in?" first, then the pad sends that class', async () => {
  const cls = { roster: { lists: 2, classes: [{ key: 'k3b', label: '3-B' }, { key: 'k5a', label: '5-A' }] }, chips: [] };
  const p = page({ cls, replies: [{ status: 404, ok: false, body: { error: 'roll_unknown' } }] });
  p.ctx.who();
  expect(p.last().name).toBe('M4-class');
  expect(p.last().h).toContain('Which class are you in?');
  expect(p.last().h).toContain('3-B');
  expect(p.last().h).not.toMatch(/wq-go/);
  p.tap((n) => n.a['data-cls'] === 'k5a');
  expect(p.last().name).toBe('M4-roll');
  p.key('7'); p.key('go');
  await flush();
  expect(p.calls[0]).toMatchObject({ roll: '7', list: 'k5a' });
});

test('"My class is not here": the name box, and the name goes as a child not on any list', async () => {
  const cls = { roster: { lists: 2, classes: [{ key: 'k3b', label: '3-B' }, { key: 'k5a', label: '5-A' }] }, chips: [] };
  const p = page({ cls, replies: [{ status: 200, ok: true, body: { st: 's', counted: true, child: { first: 'Moiz' } } }] });
  p.ctx.who();
  p.byId['#wq-notmine']();
  expect(p.last().name).toBe('M4-new');
  p.ctx.startSession({ new: { name: 'Moiz', cls: '3', force: false } }, null, 'Moiz');
  await flush();
  expect(p.calls[0]).toMatchObject({ list: 'none' });
});

test('the server asks which class (which_class): the class screen, from its list', async () => {
  const p = page({ replies: [{ status: 409, ok: false, body: { error: 'which_class', classes: [{ key: 'x', label: '3-B' }, { key: 'y', label: '4-A' }] } }] });
  p.ctx.who();
  p.key('1'); p.key('go');
  await flush();
  expect(p.last().name).toBe('M4-class');
  expect(p.last().h).toContain('4-A');
});

test("I don't know my number: the name box", () => {
  const p = page();
  p.ctx.who();
  p.byId['#wq-noroll']();
  expect(p.last().name).toBe('M4-new');
});

// One digit rule for the whole page: 0-9, Urdu pages included. The roll number is matched to the
// teacher's register, which (like every other surface) prints it 0-9.
test('Urdu: 0-9 on the keys, on the roll display and in the "no one has number" line', async () => {
  const p = page({ lang: 'ur', replies: [{ status: 404, ok: false, body: { error: 'roll_unknown' } }] });
  p.ctx.who();
  expect(p.last().h).toContain('آپ کا رول نمبر کیا ہے؟');
  expect(p.last().h).toContain('>7<');
  expect(p.last().h).not.toMatch(/[۰-۹]/);
  p.key('2'); p.key('8');
  expect(p.last().h).toContain('aria-live="polite">28<');
  p.key('del'); p.key('del'); p.key('3'); p.key('1'); p.key('go');
  await flush();
  expect(p.last().h).toContain('نمبر 31 کسی کا نہیں');
  expect(p.last().h).not.toMatch(/[۰-۹]/);
});

test('Urdu: a class label like 3-B is an LTR isolate, so it never paints as B-3', () => {
  const p = page({ lang: 'ur', cls: { roster: { lists: 2, classes: [{ key: 'a', label: '3-B' }, { key: 'b', label: '4-A' }] }, chips: [] } });
  p.ctx.who();
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

test('two children of the class share a name: the card shows the roll number under the name', async () => {
  const p = page({ replies: [{ status: 409, ok: false, body: { error: 'maybe_you', candidates: [
    { chip: 'a', first: 'Ayesha', animal: 'owl', roll: 1 }, { chip: 'b', first: 'Ayesha', animal: 'cat', roll: 7 }] } }] });
  p.ctx.who();
  p.ctx.startSession({ new: { name: 'Ayesha', cls: '3', force: false } }, null, 'Ayesha');
  await flush();
  expect(p.last().h).toContain('Roll 1');
  p.byId['#wq-diff']();
  expect(p.last().h).toContain('Roll 7');
});

test('Urdu: the refusal says where it leads, in a neutral form', async () => {
  const p = page({ lang: 'ur', replies: [{ status: 409, ok: false, body: { error: 'maybe_you', candidates: [{ chip: 'a', first: 'x', animal: 'owl' }] } }] });
  p.ctx.who();
  p.ctx.startSession({ new: { name: 'x', cls: '3', force: false } }, null, 'x');
  await flush();
  expect(p.last().h).toContain('نہیں، میں کوئی اور ہوں');
});
