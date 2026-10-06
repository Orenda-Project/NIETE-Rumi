/**
 * Web quiz page: a child remembered on this phone whom the server no longer recognises.
 *
 * "Play as <name>" sends the remembered child's chip. If this quiz's class list does not
 * know that child (they played a quiz of another class on this phone, or the teacher
 * removed them from the list), the server answers 404 chip_unknown. The page must forget
 * that child on this phone and ask who is playing, not show "Something went wrong" on every
 * tap. Runs the page's own M4 + E3 blocks, cut from the shipped file, in a vm; the DOM and
 * the network (api) are the faked boundaries, as in web-quiz-roll.service.test.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(process.env.WQ_SRC || path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf("  /* ---------------- M4 who's playing");
const END = SRC.indexOf('  /* ---------------- M5 video');

function page({ kids = [], replies = [], cls = { roster: { lists: 1 }, chips: [] } } = {}) {
  const screens = [];
  const toasts = [];
  const events = [];
  const stored = { wq_kids: kids.slice() };
  const ctx = {
    LANG: 'en', CLS: cls, CLASS_LABEL: 'your class', Q: { grade: '3' }, QS: [], B: {}, params: {}, CODE: 'AB12CD',
    S: { answers: {}, queue: [] }, ROOT: { querySelectorAll: () => [] },
    T: { whoT: 'Whose turn is it?', whoSay: 'Tap your name.', onPhone: 'On this phone', inClass: (c) => `Find your name in ${c}`,
      newKid: "I'm new", back: 'Back', newT: 'First name?', newSay: 'x', privacy: 'p', start: 'Start',
      isYou: (n) => `Are you ${n}?`, isYouSub: 'Tap Yes only if this is your own name.', yesMe: "Yes, it's me", diff: (n) => `I'm a different ${n}`,
      oops: 'Something went wrong', offline: 'offline' },
    esc: (s) => String(s == null ? '' : s), ani: (a) => `[${a}]`, bar: () => '', jug: (m, say) => `<p class="jug">${say}</p>`, wireBar: () => {},
    render: (h, name) => { screens.push({ h, name }); },
    on: () => {}, $: () => ({ value: '', focus() {}, addEventListener() {} }),
    kids: () => stored.wq_kids || [], rememberKid: () => {}, save: () => {},
    sget: (k, d) => (k in stored ? stored[k] : d), sset: (k, v) => { stored[k] = v; },
    ev: (n, p) => events.push({ n, p }), toast: (t) => toasts.push(t), landing: () => screens.push({ name: 'M3', h: '' }),
    video: () => {}, nextQuestion: () => screens.push({ name: 'Q', h: '' }),
    api: () => Promise.resolve(replies.shift()),
  };
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.who = who; this.startSession = startSession;`, ctx);
  return { ctx, screens, toasts, events, stored, last: () => screens[screens.length - 1] };
}
const flush = () => new Promise((r) => setImmediate(r));
const GONE = { status: 404, ok: false, body: { error: 'chip_unknown' } };

test('"Play as" a remembered child the server no longer knows: forget them here and ask who is playing, no error', async () => {
  const stale = { chip: 'old', first: 'Fatir', animal: 'owl' };
  const other = { chip: 'keep', first: 'Hina', animal: 'cat' };
  const p = page({ kids: [stale, other], replies: [GONE] });
  p.ctx.startSession({ chip: 'old', via: 'remembered' }, stale);
  await flush();
  expect(p.toasts).toEqual([]);
  expect(p.last().name).toBe('M4-roll');
  expect(p.stored.wq_kids).toEqual([other]);
  expect(p.events).toEqual(expect.arrayContaining([expect.objectContaining({ n: 'identity_pick', p: { src: 'remembered_gone' } })]));
});

test('the same from the "Whose turn?" list (a remembered child tapped there)', async () => {
  const stale = { chip: 'old', first: 'Fatir', animal: 'owl' };
  const p = page({ kids: [stale], replies: [GONE], cls: { chips: [] } });
  p.ctx.startSession({ chip: 'old', via: 'remembered' }, stale);
  await flush();
  expect(p.toasts).toEqual([]);
  expect(p.stored.wq_kids).toEqual([]);
  expect(p.last().name).toMatch(/^M4/);
});

test('a 404 for a roll number is still the pad with "no one has that number" (unchanged)', async () => {
  const p = page({ replies: [{ status: 404, ok: false, body: { error: 'roll_unknown' } }] });
  p.ctx.startSession({ roll: '31' }, null, '', '31');
  await flush();
  expect(p.toasts).toEqual([]);
  expect(p.last().name).toBe('M4-roll');
});

test('any other failure still shows the error (the fix is only for a remembered child)', async () => {
  const p = page({ replies: [{ status: 502, ok: false, body: { error: 'db_unavailable' } }] });
  p.ctx.startSession({ chip: 'x', via: 'remembered' }, { chip: 'x', first: 'A' });
  await flush();
  expect(p.toasts).toEqual(['Something went wrong']);
});
