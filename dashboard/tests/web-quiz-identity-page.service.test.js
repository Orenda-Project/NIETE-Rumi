/**
 * Web quiz page, "who is playing?" v2 (cls.identity.mode === 'v2'): name first.
 *
 * S0 remembered children as cards + "Someone else"; S1 the class only when the hand-out is
 * ambiguous; S2 "What is your name?"; S3 a same-name collision is ASKED (full name, father's
 * name, list number; "I don't know" moves on), never shown; S4 ONE "Are you X?" card; S5 "I
 * can't find X" -> "Yes, that's my name" (new.force). A hub link /q/<code>?k=<chip> plays as
 * that child. Without the flag every screen stays as before.
 *
 * Runs the page's own landing + M4 + E3 blocks cut from the shipped wq.js, plus the shipped
 * wq-identity.js, in a vm; the DOM and the network (api) are the faked boundaries, as in
 * web-quiz-roll.service.test.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'public', 'wq');
const SRC = fs.readFileSync(path.join(DIR, 'wq.js'), 'utf8');
const ID_FILE = path.join(DIR, 'wq-identity.js');
const ID_SRC = fs.existsSync(ID_FILE) ? fs.readFileSync(ID_FILE, 'utf8') : '';
const START = SRC.indexOf('  /* ---------------- M3 landing');
const END = SRC.indexOf('  /* ---------------- M5 video');

const V2 = (over = {}) => ({ chips: [], identity: { mode: 'v2', class: { state: 'known', label: '4-A', ask: null }, roster: true, invited: false, ...over } });

function page({ lang = 'en', cls = V2(), kids = [], replies = [], params = {} } = {}) {
  const screens = [];
  const calls = [];
  const events = [];
  const toasts = [];
  const stored = { wq_kids: kids.slice() };
  let byId = {};
  const pads = {};
  const inputs = {};
  const doc = { nodes: [] };
  const ctx = {
    LANG: lang, CLS: cls, CLASS_LABEL: '4-A', Q: { grade: '4', topic: 'Fractions' }, QS: [], N: 5, B: {}, LIVE: {}, params, CODE: 'AB12CD',
    S: { answers: {}, queue: [] },
    ROOT: { querySelectorAll: (sel) => {
      const m = sel.match(/^\[([\w-]+)\]$/);
      if (!m) return [];
      return (last().h.match(/<button\b[^>]*>/g) || []).filter((t) => t.includes(` ${m[1]}="`)).map((t) => {
        const v = t.match(new RegExp(`${m[1]}="([^"]*)"`))[1];
        return { getAttribute: (k) => (k === m[1] ? v : null), addEventListener: (n, fn) => { pads[v] = fn; } };
      });
    } },
    T: { whoT: 'Whose turn is it?', whoSay: 'Tap your name.', onPhone: 'On this phone', inClass: (c) => `Find your name in ${c}`,
      newKid: "I'm new", back: 'Back', newT: 'First name?', newSay: 'x', privacy: 'p', start: 'Start', play: 'Play',
      hello: 'Hello', helloN: (n) => `Welcome back, ${n}!`, from: () => 'From T', meta: () => '5 questions', playAs: (n) => `Play as ${n}`, notMe: (n) => `Not ${n}?`,
      isYou: (n) => `Are you ${n}?`, isYouSub: 'Tap Yes only if this is your own name.', yesMe: "Yes, it's me", next: 'Next',
      oops: 'oops', offline: 'offline', challenged: () => '', challengedBy: () => '', proof: () => '', classToday: () => '' },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    ani: (a) => `[${a}]`, bar: () => '', jug: (m, say) => `<p class="jug">${say}</p>`, wireBar: () => {},
    render: (h, name) => { screens.push({ h, name }); byId = {}; },
    on: (sel, fn) => { byId[sel] = fn; },
    $: (sel) => { const id = sel.replace(/^#/, ''); inputs[id] = inputs[id] || { value: '', focus() {}, addEventListener() {} }; return inputs[id]; },
    kids: () => stored.wq_kids || [], rememberKid: () => {}, save: () => {},
    sget: (k, d) => (k in stored ? stored[k] : d), sset: (k, v) => { stored[k] = v; },
    ev: (n, p) => events.push({ n, p }), toast: (t) => toasts.push(t),
    video: () => {}, nextQuestion: () => screens.push({ name: 'Q', h: '' }), whoPlayed: () => {}, flushQueue: () => {},
    api: (m, p, body) => { calls.push({ p, body: JSON.parse(JSON.stringify(body)) }); return Promise.resolve(replies.shift() || { status: 200, ok: true, body: { st: 's', child: { chip: 'c', first: 'Ali', animal: 'lion' } } }); },
    location: { search: '' }, history: { replaceState() {} },
    document: {
      body: { appendChild: (el) => { doc.nodes.push(el); el.parentNode = { removeChild: (x) => { doc.nodes = doc.nodes.filter((n) => n !== x); } }; } },
      createElement: () => { const el = { className: '', textContent: '', listeners: {}, addEventListener(n, fn) { el.listeners[n] = fn; }, setAttribute() {} }; return el; },
    },
    setTimeout: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(`${ID_SRC}\n${SRC.slice(START, END)}\nthis.who = who; this.landing = landing; this.startSession = startSession; this.whichClass = whichClass;`, ctx);
  const last = () => screens[screens.length - 1];
  return {
    ctx, screens, calls, events, toasts, stored, last, doc,
    tap: (id) => { const fn = byId[`#${id}`]; if (!fn) throw new Error(`no #${id} on ${last().name}: ${Object.keys(byId).join(' ')}`); fn(); },
    type: (id, v) => { ctx.$(`#${id}`).value = v; },
    has: (id) => Boolean(byId[`#${id}`]),
    key: (k) => pads[k](),
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const srcs = (p) => p.events.filter((e) => e.n === 'identity_pick').map((e) => e.p.src);

describe('flag off: the W35 screens are unchanged', () => {
  test('a roster quiz without cls.identity still opens on the roll pad', () => {
    const p = page({ cls: { roster: { lists: 1 }, chips: [] } });
    p.ctx.who();
    expect(p.last().name).toBe('M4-roll');
  });
  test('a quiz with identity mode v1 is the old path too', () => {
    const p = page({ cls: { roster: { lists: 1 }, chips: [], identity: { mode: 'v1' } } });
    p.ctx.who();
    expect(p.last().name).toBe('M4-roll');
  });
});

describe('S0 landing', () => {
  test('remembered children are cards, plus "Someone else"; a card plays as that child', async () => {
    const kids = [{ chip: 'c1', first: 'Ayesha', animal: 'lion' }, { chip: 'c2', first: 'Bilal', animal: 'owl' }];
    const p = page({ kids });
    p.ctx.landing();
    expect(p.last().name).toBe('M4-who-v2');
    expect(p.last().h).toContain('Ayesha');
    expect(p.last().h).toContain('Bilal');
    expect(p.last().h).toContain('Someone else');
    p.tap('wq-kid-1');
    await flush();
    expect(p.calls[0].body).toMatchObject({ code: 'AB12CD', chip: 'c2', via: 'remembered' });
    expect(srcs(p)).toEqual(['remembered']);
  });
  test('classmates playing right now (E2 live.now, from 2 up): the v2 landing says so, a friend\'s challenge never', () => {
    const live = (over = {}, challenge = null) => {
      const p = page(over);
      p.ctx.LIVE.now = 3;
      p.ctx.T.liveNow = (n) => `${n} classmates are playing right now — join them!`;
      if (challenge) { p.ctx.B.challenge = challenge; p.ctx.T.challenged = (n, c, t) => `${n} got ${c}/${t} stars. Can you beat it?`; }
      p.ctx.landing();
      return p.last().h;
    };
    expect(live()).toContain('3 classmates are playing right now — join them!');
    expect(live({ kids: [{ chip: 'c1', first: 'Ayesha', animal: 'lion' }] })).toContain('3 classmates are playing right now');
    const friend = live({}, { first: 'Ali', correct: 4, total: 5 });
    expect(friend).toContain('Ali got 4/5 stars'); // the challenge landing really rendered
    expect(friend).not.toContain('playing right now');
    expect(live({ cls: V2({ invited: true }) })).not.toContain('playing right now');
    const one = page(); one.ctx.LIVE.now = 1; one.ctx.T.liveNow = (n) => `${n} classmates are playing right now`; one.ctx.landing();
    expect(one.last().h).not.toContain('playing right now');
  });
  test('"Someone else" goes to "What is your name?" (no roll pad)', () => {
    const p = page({ kids: [{ chip: 'c1', first: 'Ayesha', animal: 'lion' }] });
    p.ctx.landing();
    p.tap('wq-someone');
    expect(p.last().name).toBe('M4-name');
    expect(srcs(p)).toEqual(['someone_else']);
  });
  test('first visit: one Play button, then the name screen', () => {
    const p = page();
    p.ctx.landing();
    expect(p.last().h).not.toContain('Someone else');
    p.tap('wq-play');
    expect(p.last().name).toBe('M4-name');
  });
  test('Urdu copy', () => {
    const p = page({ lang: 'ur', kids: [{ chip: 'c1', first: 'Ayesha', animal: 'lion' }] });
    p.ctx.landing();
    expect(p.last().h).toContain('کوئی اور');
    p.tap('wq-someone');
    expect(p.last().h).toContain('آپ کا نام کیا ہے؟');
    expect(p.last().h).toContain('وہ نام لکھیں جس سے آپ کو کلاس میں پکارا جاتا ہے۔');
    expect(p.last().h).not.toContain('لیتی');
  });
});

describe('class phone: a phone that remembers 4 or more children', () => {
  const four = ['Ayesha', 'Bilal', 'Hina', 'Omar'].map((f, i) => ({ chip: `c${i}`, first: f, animal: 'owl' }));
  test('"Someone else" comes first and the cards are the smaller kind', () => {
    const p = page({ kids: four });
    p.ctx.landing();
    const h = p.last().h;
    expect(h.indexOf('id="wq-someone"')).toBeGreaterThan(-1);
    expect(h.indexOf('id="wq-someone"')).toBeLessThan(h.indexOf('id="wq-kid-0"'));
    expect(h).toContain('wq-kids-small');
  });
  test('with fewer children the cards come first (unchanged)', () => {
    const p = page({ kids: four.slice(0, 2) });
    p.ctx.landing();
    const h = p.last().h;
    expect(h.indexOf('id="wq-kid-0"')).toBeLessThan(h.indexOf('id="wq-someone"'));
    expect(h).not.toContain('wq-kids-small');
  });
  test('a card tapped on a class phone: a "Not Hina?" undo floats over the first question; tapping it logs wrong_card and asks the name', async () => {
    const p = page({ kids: four, replies: [{ status: 200, ok: true, body: { st: 's', child: { chip: 'c2', first: 'Hina', animal: 'owl' } } }] });
    p.ctx.landing();
    p.tap('wq-kid-2');
    await flush();
    expect(p.last().name).toBe('Q');
    expect(p.doc.nodes).toHaveLength(1);
    expect(p.doc.nodes[0].textContent).toBe('Not Hina?');
    p.doc.nodes[0].listeners.click();
    expect(p.doc.nodes).toHaveLength(0);
    expect(p.last().name).toBe('M4-name');
    const e = p.events.find((x) => x.p && x.p.src === 'wrong_card');
    expect(e).toBeTruthy();
    expect(typeof e.p.ms).toBe('number');
  });
  test('siblings on one phone (2 remembered children): the "Not Ayesha?" undo floats over the first question too', async () => {
    const p = page({ kids: four.slice(0, 2), replies: [{ status: 200, ok: true, body: { st: 's', child: { chip: 'c0', first: 'Ayesha', animal: 'owl' } } }] });
    p.ctx.landing();
    p.tap('wq-kid-0');
    await flush();
    expect(p.last().name).toBe('Q');
    expect(p.doc.nodes).toHaveLength(1);
    expect(p.doc.nodes[0].textContent).toBe('Not Ayesha?');
    p.doc.nodes[0].listeners.click();
    expect(p.last().name).toBe('M4-name');
  });
  test('no undo when the phone has only one child, or the child typed their name', async () => {
    const p = page({ kids: four.slice(0, 1) });
    p.ctx.landing();
    p.tap('wq-kid-0');
    await flush();
    expect(p.doc.nodes).toHaveLength(0);
    const q = page({ kids: four, replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'x', first: 'Zara', animal: 'cat' }] } }] });
    q.ctx.who();
    q.type('wq-name', 'Zara');
    q.tap('wq-start');
    await flush();
    q.tap('wq-yes');
    await flush();
    expect(q.doc.nodes).toHaveLength(0);
  });
});

describe('hub ?k=<chip>', () => {
  test('plays as that child straight away', async () => {
    const p = page({ params: { k: 'hubchip' } });
    p.ctx.landing();
    await flush();
    expect(p.calls[0].body).toMatchObject({ chip: 'hubchip', via: 'hub' });
    expect(srcs(p)).toEqual(['hub']);
    expect(p.last().name).toBe('Q');
  });
  test('a chip the server does not know: forgotten, then the name screen; k is used once', async () => {
    const p = page({ params: { k: 'gone' }, kids: [{ chip: 'gone', first: 'Ayesha', animal: 'lion' }], replies: [{ status: 404, ok: false, body: { error: 'chip_unknown' } }] });
    p.ctx.landing();
    await flush();
    expect(p.stored.wq_kids).toEqual([]);
    expect(p.last().name).toBe('M4-name');
    expect(srcs(p)).toEqual(['hub', 'remembered_gone']);
    p.ctx.landing();
    expect(p.calls).toHaveLength(1);
  });
});

describe('S1 class, only when the hand-out is ambiguous', () => {
  test('ambiguous: the class first, then the name; the key is sent as list', async () => {
    const p = page({ cls: V2({ class: { state: 'ambiguous', label: null, ask: [{ key: 'k4a', label: '4-A' }, { key: 'k4b', label: '4-B' }] } }) });
    p.ctx.who();
    expect(p.last().name).toBe('M4-class');
    expect(p.last().h).toContain('4-B');
    p.tap('wq-cls-1');
    expect(p.last().name).toBe('M4-name');
  });
  test('known class: straight to the name', () => {
    const p = page();
    p.ctx.who();
    expect(p.last().name).toBe('M4-name');
  });
  test('invited friend: name only, even when the class is ambiguous', () => {
    const p = page({ cls: V2({ roster: false, invited: true, class: { state: 'ambiguous', ask: [{ key: 'a', label: '4-A' }] } }) });
    p.ctx.who();
    expect(p.last().name).toBe('M4-name');
  });
});

describe('S2 -> S3 -> S4 -> S5', () => {
  async function named(p, name) {
    p.ctx.who();
    p.type('wq-name', name);
    p.tap('wq-start');
    await flush();
  }
  test('a unique name: ONE "Are you X?" card even if the server sent more; Yes plays as that chip', async () => {
    const p = page({ replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'a1', first: 'Ayesha', animal: 'lion', cls: '4-A' }, { chip: 'z9', first: 'Zara', animal: 'owl' }] } }] });
    await named(p, 'ayesha');
    expect(p.calls[0].body).toMatchObject({ code: 'AB12CD', new: { name: 'ayesha' }, via: 'name' });
    expect(p.last().name).toBe('M4-isyou');
    expect(p.last().h).toContain('Are you Ayesha?');
    expect(p.last().h).not.toContain('Zara');
    expect(p.last().h).not.toContain('4-A');   // the class label only when the child chose it
    expect((p.last().h.match(/wq-go/g) || []).length).toBe(1);
    p.tap('wq-yes');
    await flush();
    expect(p.calls[1].body).toMatchObject({ chip: 'a1' });
    expect(srcs(p)).toEqual(['name', 'is_this_you']);
  });
  test('"No" goes back to the name screen asking for the full name', async () => {
    const p = page({ replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'a1', first: 'Ayesha', animal: 'lion' }] } }] });
    await named(p, 'ayesha');
    p.tap('wq-diff');
    expect(p.last().name).toBe('M4-name');
    expect(p.last().h).toContain('Type your full name.');
    expect(srcs(p)).toContain('not_me');
  });
  test('a collision is ASKED: full name, then father, answers accumulate in one new object', async () => {
    const p = page({ replies: [
      { status: 409, ok: false, body: { error: 'ask_more', need: 'full_name', first: 'Ali', cls: '4-A' } },
      { status: 409, ok: false, body: { error: 'ask_more', need: 'father', first: 'Ali' } },
      { status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'a7', first: 'Ali', animal: 'cat' }] } },
    ] });
    await named(p, 'Ali');
    expect(p.last().name).toBe('M4-ask');
    expect(p.last().h).toContain('There is more than one');
    expect(p.last().h).toContain('4-A');
    expect(p.ctx.$('#wq-more').value).toBe('Ali');   // prefilled with what was typed
    p.type('wq-more', 'Ali Raza');
    p.tap('wq-more-go');
    await flush();
    expect(p.calls[1].body).toMatchObject({ new: { name: 'Ali', full_name: 'Ali Raza' }, via: 'full_name' });
    expect(p.last().h).toContain("What is your father's name?");
    p.type('wq-more', 'Ahmed');
    p.tap('wq-more-go');
    await flush();
    expect(p.calls[2].body.new).toEqual(expect.objectContaining({ name: 'Ali', full_name: 'Ali Raza', father: 'Ahmed' }));
    expect(p.last().name).toBe('M4-isyou');
    expect(srcs(p)).toEqual(['name', 'full_name', 'father']);
  });
  test('the number need is the digit pad; "I don\'t know" twice resends nulls and ends provisional', async () => {
    const p = page({ replies: [
      { status: 409, ok: false, body: { error: 'ask_more', need: 'father', first: 'Ali' } },
      { status: 409, ok: false, body: { error: 'ask_more', need: 'number', first: 'Ali' } },
      { status: 409, ok: false, body: { error: 'not_found', typed: 'Ali', cls: '4-A' } },
    ] });
    await named(p, 'Ali');
    p.tap('wq-dontknow');
    await flush();
    expect(p.calls[1].body.new).toEqual(expect.objectContaining({ name: 'Ali', father: null }));
    expect(p.last().name).toBe('M4-ask-number');
    expect(p.last().h).toContain('What number does your teacher call you by?');
    expect(p.last().h).not.toContain('Or tap your name');
    p.tap('wq-noroll');
    await flush();
    expect(p.calls[2].body.new).toEqual(expect.objectContaining({ name: 'Ali', father: null, number: null }));
    expect(p.last().name).toBe('M4-notfound');
    expect(p.last().h).toContain("I can't find");
    p.tap('wq-force');
    await flush();
    expect(p.calls[3].body.new).toEqual(expect.objectContaining({ name: 'Ali', force: true }));
    expect(p.last().name).toBe('Q');
    expect(srcs(p)).toEqual(['name', 'dont_know', 'dont_know', 'new_force']);
  });
  test('S5 after a same-name collision the child could not settle: names the real state (several Hinas), never "I can\'t find"', async () => {
    const p = page({ replies: [
      { status: 409, ok: false, body: { error: 'ask_more', need: 'number', first: 'Hina' } },
      { status: 409, ok: false, body: { error: 'not_found', typed: 'Hina', cls: '4-A', same: 3 } },
    ] });
    await named(p, 'Hina');
    p.tap('wq-noroll');
    await flush();
    const h = p.last().h;
    expect(h).toContain('There are 3 children called <bdi>Hina</bdi> in <bdi dir="ltr" class="wq-nw">4-A</bdi>.');
    expect(h).not.toContain("I can't find");
    expect(h).not.toContain('wq-fix');
    // the bubble is plain text: the class is an LTR isolate with a no-break hyphen (never "4-" / "A")
    expect(h).toContain('<p class="jug">There are 3 children called Hina in \u20664\u2011A\u2069. Tap Yes to play.');
    p.tap('wq-force');
    await flush();
    expect(p.calls[2].body.new).toEqual(expect.objectContaining({ name: 'Hina', force: true }));
    expect(p.last().name).toBe('Q');
  });
  test('S5 Urdu: the same-name state and the true not-found are gender-neutral (no verb on the child\'s name)', async () => {
    const p = page({ lang: 'ur', replies: [
      { status: 409, ok: false, body: { error: 'not_found', typed: 'Hina', cls: '4-A', same: 3 } },
      { status: 409, ok: false, body: { error: 'not_found', typed: 'Hina', cls: '4-A' } },
    ] });
    await named(p, 'Hina');
    expect(p.last().h).toContain('Hina</bdi> نام کے 3 بچے ہیں');
    p.tap('wq-back');
    p.type('wq-name', 'Hina');
    p.tap('wq-start');
    await flush();
    expect(p.last().h).toContain('Hina</bdi> کا نام نہیں ملا');
    expect(p.last().h).not.toMatch(/Hina<\/bdi> نہیں ملا/);
  });
  test('S5 "Let me fix it" goes back to the name, prefilled', async () => {
    const p = page({ replies: [{ status: 409, ok: false, body: { error: 'not_found', typed: 'Aleena' } }] });
    await named(p, 'Aleena');
    p.tap('wq-fix');
    expect(p.last().name).toBe('M4-name');
    expect(p.ctx.$('#wq-name').value).toBe('Aleena');
  });
  test('the class the child chose goes as list on every round-trip and shows on the card', async () => {
    const ask = [{ key: 'k4b', label: '4-B' }];
    const p = page({ cls: V2({ class: { state: 'ambiguous', ask } }), replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'b1', first: 'Sana', animal: 'bee' }] } }] });
    p.ctx.who();
    p.tap('wq-cls-0');
    expect(p.last().name).toBe('M4-name');
    p.type('wq-name', 'Sana');
    p.tap('wq-start');
    await flush();
    expect(p.calls[0].body).toMatchObject({ list: 'k4b' });
    expect(p.last().h).toContain('4-B');
    expect(srcs(p)).toEqual(['class', 'name']);
  });
  test('Urdu S3/S5 copy is gender-neutral', async () => {
    const p = page({ lang: 'ur', replies: [
      { status: 409, ok: false, body: { error: 'ask_more', need: 'number', first: 'علی' } },
      { status: 409, ok: false, body: { error: 'not_found', typed: 'علی' } },
    ] });
    await named(p, 'علی');
    expect(p.last().h).toContain('کلاس لسٹ میں آپ کا نمبر کیا ہے؟');
    expect(p.last().h).toContain('مجھے نہیں پتا');
    expect(p.last().h).not.toContain('لیتی');
    p.tap('wq-noroll');
    await flush();
    expect(p.last().h).toContain('کیا آپ کا نام ایسے ہی لکھا جاتا ہے؟');
    expect(p.last().h).toContain('جی ہاں، یہی میرا نام ہے');
  });
  test('the number need: digits on the pad, Go sends new.number with the earlier answers', async () => {
    const p = page({ replies: [
      { status: 409, ok: false, body: { error: 'ask_more', need: 'number', first: 'Ali' } },
      { status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'a3', first: 'Ali', animal: 'dog' }] } },
    ] });
    await named(p, 'Ali');
    p.key('1');
    p.key('2');
    p.key('go');
    await flush();
    expect(p.calls[1].body).toMatchObject({ new: { name: 'Ali', number: '12' }, via: 'number' });
    expect(p.last().name).toBe('M4-isyou');
    expect(srcs(p)).toEqual(['name', 'number']);
  });
});

describe('the shell loads wq-identity.js only for a v2 quiz', () => {
  const { renderQuizPage } = require('../routes/web-quiz.routes');
  const payload = (cls) => ({ quiz: { id: 'q-1', code: 'AB12CD', topic: 'Plants', lang: 'en', grade: '3', n: 1, questions: [] }, cls, live: {}, video: null });
  const html = (cls) => renderQuizPage({ payload: payload(cls), code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
  test('v2: the identity script, deferred, before wq.js', () => {
    const h = html(V2());
    const a = h.indexOf('<script src="/wq/wq-identity.js?v=v1" defer></script>');
    const b = h.indexOf('<script src="/wq/wq.js?v=v1" defer></script>');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });
  test('flag off: no extra script', () => {
    expect(html({ label: 'Class 3', chips: [] })).not.toContain('wq-identity.js');
  });
});

describe('a phone holding one child\'s open session (resume_st), then another child', () => {
  const tooba = { chip: 't1', first: 'Tooba', animal: 'turtle' };
  test('"Not Tooba?" → a new name → Yes: the session request carries no resume_st, so Tooba\'s session is never continued', async () => {
    const p = page({ kids: [tooba], replies: [{ status: 409, ok: false, body: { error: 'is_this_you', candidates: [{ chip: 'y1', first: 'Yusra', animal: 'bee' }] } }] });
    Object.assign(p.ctx.S, { st: 'ST-TOOBA', child: tooba, answers: { q1: { slot: 'A', ok: true }, q2: { slot: 'B', ok: false } } });
    p.ctx.who();
    p.type('wq-name', 'Yusra');
    p.tap('wq-start');
    await flush();
    expect(p.calls[0].body.resume_st).toBeUndefined();
    p.tap('wq-yes');
    await flush();
    expect(p.calls[1].body).toMatchObject({ chip: 'y1' });
    expect(p.calls[1].body.resume_st).toBeUndefined();
  });
  test('another remembered card tapped: no resume_st; the same child\'s own card keeps it', async () => {
    const yusra = { chip: 'y1', first: 'Yusra', animal: 'bee' };
    const p = page({ kids: [tooba, yusra] });
    Object.assign(p.ctx.S, { st: 'ST-TOOBA', child: tooba });
    p.ctx.landing();
    p.tap('wq-kid-1');
    await flush();
    expect(p.calls[0].body).toMatchObject({ chip: 'y1' });
    expect(p.calls[0].body.resume_st).toBeUndefined();
    const q = page({ kids: [tooba, yusra] });
    Object.assign(q.ctx.S, { st: 'ST-TOOBA', child: tooba });
    q.ctx.landing();
    q.tap('wq-kid-0');
    await flush();
    expect(q.calls[0].body).toMatchObject({ chip: 't1', resume_st: 'ST-TOOBA' });
  });
});
