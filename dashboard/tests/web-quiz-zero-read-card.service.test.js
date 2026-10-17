/**
 * A counted live read (live reading v3) on the Jugnu page's Trail with the finish card on (card_v3), where the child
 * taps "Stop for now" at 0 words. It ends on the kind card — "Let's read it together", no sticker, no Share (a read
 * that never happened is not shared) — and never on "Just wait a little." forever:
 * - the live socket was up and heard nothing: the page knows at Stop, so the kind card comes at once (no "Listening…",
 *   no 10-s wait); the recording still goes up for the record, and a later check moves nothing;
 * - no live socket (the key was refused): "Listening…", the 10-s card from r.later, and the server's settled
 *   "nothing read" turns that card into the kind card while it is open.
 * The page runs whole in a vm (wqc-page-harness.js); only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./wqc-page-harness');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const LIVE_SRC = fs.readFileSync(path.join(WQ, 'wq-read-live.js'), 'utf8');
const LR_SRC = fs.readFileSync(path.join(WQ, 'wq-liveread.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(WQ, 'wq-trail.js'), 'utf8');
const FC_SRC = fs.readFileSync(path.join(WQ, 'wq-finish-card.js'), 'utf8');
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5' };
const TC = { stopDone: 'Stop done!', badge: 'Done', next: 'Next', mic: 'uses the microphone' };
const V2 = { pool: true, story: false };
const LR3 = { meter: 'glow', done: true, done_from: 0.8, counted: true, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: false } };
const NEXT = { kind: 'storybook', id: 'b1', href: '/s/b1/1', title: 'Read a storybook', title_ur: 'کہانی کی کتاب پڑھیں', minutes: 2 };
const MENU = (lang, fold) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, v2: V2, card_v3: true, lr3: true, ...(fold ? { card_fold: true } : {}), exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }] });
const READ = (lang) => ({ ex: 'read', ct: 'CT1', secs: 60, live: true, lang, clips: H.CLIPS, record: true, trail: true, trail_copy: TC, v2: V2, lr3: LR3, story: H.STORY, next_offer: NEXT });

class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; this.bufferedAmount = 0; FakeSocket.all.push(this); }
  send(x) { this.sent.push(x); }
  close() { this.closed = true; }
  open() { if (this.onopen) this.onopen({}); }
  msg(m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
}
function trail(lang, { fold = false, liveKey = true, read = {}, words = null } = {}) {
  FakeSocket.all = [];
  const server = { now: { status: 200, body: { pending: true } } };
  let p = null;
  const up = H.ok({ put_url: 'https://r2.test/put/abc', key: 'child-voice/sandbox/r/read-1.webm', content_type: 'audio/webm' });
  p = H.page({ lang, menu: MENU(lang, fold), freshEls: true, pre: [LIVE_SRC, LR_SRC, TRAIL_SRC, FC_SRC], routes: {
    'ch/HUB.TOKEN/read': H.ok({ ...READ(lang), ...read }),
    'ch/words/': (u, i) => (typeof words === 'function' ? words(u, i) : words) || { status: 404, body: { error: 'no_words' } },
    'ch/live': liveKey ? H.ok({ ...KEY, lang }) : () => ({ status: 503, body: { error: 'no_key' } }),
    // the screen as it stood when the recording started up (the order the card and the upload come in)
    'ch/upload': (...a) => { if (p && !server.atUpload) server.atUpload = p.screen(); return up(...a); },
    'r2.test/put': () => ({ status: 200, body: {} }),
    'ch/result': () => server.now,
  } });
  p.win.WebSocket = FakeSocket;
  p.server = server;
  return p;
}
// the walk: open → no help → go → (live) → "Stop for now" at 0 words → the socket finishes with nothing heard
const stopAtZero = async (p) => {
  p.w.open('read'); await p.flush();
  await p.click('wqc-help-no');
  await p.click('wqc-go');
  if (FakeSocket.all[0]) { FakeSocket.all[0].open(); await p.flush(); }
  await p.click('wqc-stuck');
  if (FakeSocket.all[0]) FakeSocket.all[0].msg({ tokens: [], finished: true });
  await p.flush(); await p.flush();
};
const TOGETHER = { en: "Let's read it together", ur: 'آئیں مل کر پڑھیں' };
const WAIT = { en: 'Just wait a little.', ur: 'بس تھوڑا سا انتظار کریں۔' };
const SETTLED = {
  unheard: { failed: true, reason: 'unheard' },
  implausible: { score: { correct: 0, attempted: 0, stopped: false, finished_early: false, time_left: 0 }, wcpm: null, previous: null, ended: 'stuck', sticker: false },
  words: { score: { correct: 5, attempted: 6, stopped: false }, wcpm: 20 },
};
const homes = (h) => (h.match(/data-home\b|id="wqc-menu"/g) || []).length;
const primaries = (h) => (h.match(/data-primary/g) || []).length;
const kindCard = (p, lang) => {
  const h = p.html();
  expect(p.screen()).toBe('read-result');
  expect(h).toContain(TOGETHER[lang]);
  expect(h).not.toContain(WAIT[lang]);
  expect(p.has('wqc-sticker')).toBe(false);
  expect(h).not.toMatch(/wq-dot|data-sticker/);   // no day-dot, no sticker on the card
  expect(p.has('wqfc-share')).toBe(false);
  expect(p.has('wqc-listening')).toBe(false);
  return h;
};

describe('the live socket heard 0 words — the kind card at once, never "Listening…" then "wait"', () => {
  test.each([['en', false], ['ur', false], ['en', true], ['ur', true]])('%s (fold %s): at Stop, the kind card; no 10-s check is set', async (lang, fold) => {
    const p = trail(lang, { fold });
    await stopAtZero(p);
    const h = kindCard(p, lang);
    // nothing is left to wait for on the child's screen
    expect(p.timers.some((x) => x.ms === 10000)).toBe(false);
    if (fold) {
      // ONE Next (the card's tile) and ONE Home on the fold
      expect(primaries(h)).toBe(1);
      expect(homes(h)).toBe(1);
    } else {
      expect(p.has('wqc-again')).toBe(true);
      expect(homes(h)).toBe(1);
    }
  });
  test.each(Object.keys(SETTLED))('the recording still goes up for the record; the check settling %s moves nothing', async (k) => {
    const p = trail('en');
    await stopAtZero(p);
    const before = p.html();
    expect(p.fetches.some((f) => /ch\/upload/.test(f.url))).toBe(true);
    p.server.now = { status: 200, body: SETTLED[k] };
    for (let i = 0; i < 3; i += 1) await p.runTimers((x) => x.ms === 3000);
    expect(p.fetches.some((f) => /ch\/result/.test(f.url))).toBe(true);
    kindCard(p, 'en');
    expect(p.html()).toContain(TOGETHER.en);
    if (k === 'words') expect(p.html()).toBe(before);
  });
});

describe('no live socket — the 10-s card, then the server settles nothing read → the kind card', () => {
  test.each([
    ['ur', 'unheard'], ['ur', 'implausible'], ['en', 'unheard'], ['en', 'implausible'],
  ])('%s: the 10-s card, then the server settles %s → «together», no sticker, no Share', async (lang, k) => {
    const p = trail(lang, { liveKey: false });
    await stopAtZero(p);
    expect(['read-send', 'read-wait']).toContain(p.screen());
    // the result call answered pending; the 10-s mark fires before the scorer is back (run.json: card at +12 s)
    await p.runTimers((x) => x.ms === 10000);
    expect(p.screen()).toBe('read-result');
    expect(p.html()).toContain(WAIT[lang]);
    // the scorer settles on nothing read; the page's poll gets it while the card is still open
    p.server.now = { status: 200, body: SETTLED[k] };
    for (let i = 0; i < 3; i += 1) await p.runTimers((x) => x.ms === 3000);
    kindCard(p, lang);
  });
  test('a late answer that DID hear words still moves nothing (the 10-s card stays)', async () => {
    const p = trail('en', { liveKey: false });
    await stopAtZero(p);
    await p.runTimers((x) => x.ms === 10000);
    const before = p.html();
    p.server.now = { status: 200, body: SETTLED.words };
    for (let i = 0; i < 3; i += 1) await p.runTimers((x) => x.ms === 3000);
    expect(p.html()).toBe(before);
  });
});

describe('the try card (read_tried) offers no Share', () => {
  const ctx = { document: {}, location: { origin: 'https://portal.example' }, navigator: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(FC_SRC, ctx);
  test.each(['en', 'ur'])('%s: no wqfc-share on read_tried (with and without the tile); a read with words keeps it', (lang) => {
    expect(ctx.WQFC.html({ kind: 'read', deed: 'read_tried', lang, next: NEXT, lead: true, home: '/h/tok' })).not.toContain('id="wqfc-share"');
    expect(ctx.WQFC.html({ kind: 'read', deed: 'read_tried', lang, next: NEXT, home: '/h/tok' })).not.toContain('id="wqfc-share"');
    expect(ctx.WQFC.html({ kind: 'read', deed: 'read_some', lang, next: NEXT, lead: true, home: '/h/tok' })).toContain('id="wqfc-share"');
  });
});

// The fold's ONE Next on that card: "Hear it again" (the signed read-along word) when the passage's timings are there —
// on the serve, or asked for by the run token once the recording has gone up — and it opens Jugnu reading it word by
// word. Behind its own switch (web_quiz_zero_read_listen): the read payload says `zero_listen: true` only when it is on.
describe('on the fold: a 0-word read\'s ONE Next is "Hear it again" when the passage has its timings (switch on)', () => {
  const RA = { v: 1, id: 'p1', lang: 'en', audio: { url: 'https://r2.test/a.ogg', ms: 9000 }, words: [{ i: 0, t: 'Imran', s_ms: 0, e_ms: 400 }] };
  const REPLAY = { en: 'Hear it again', ur: 'دوبارہ سنیں' };
  const ZL = { zero_listen: true };
  const player = (p) => { const m = []; p.win.WQReadAlong = { mount: (el, ra) => { m.push(ra); return { play() { m.push('play'); }, destroy() {} }; } }; return m; };
  const nexts = (h) => (h.match(/id="(wqc-fnext|wqfc-next)"/g) || []);
  const asks = (p) => p.fetches.filter((f) => /ch\/words\//.test(f.url));
  const at = (p, rx) => p.fetches.findIndex((f) => rx.test(f.url));
  // the words call as the server answers it: 409 (pending) while the run is still being checked, then the timings
  const pendingThen = (n409) => { let n = 0; return () => { n += 1; return n <= n409 ? { status: 409, body: { error: 'pending' } } : { status: 200, body: { readalong: RA } }; }; };
  test.each(['en', 'ur'])('%s: timings on the serve → ONE Next «Hear it again», no tile, one Home; the tap plays Jugnu', async (lang) => {
    const p = trail(lang, { fold: true, read: { ...ZL, hear_first: RA } });
    const m = player(p);
    await stopAtZero(p);
    const h = kindCard(p, lang);
    expect(nexts(h)).toEqual(['id="wqc-fnext"']);
    expect(h).toMatch(new RegExp(`<button class="wq-btn wq-go" id="wqc-fnext" data-primary type="button">${REPLAY[lang]}</button>`));
    expect(primaries(h)).toBe(1);
    expect(homes(h)).toBe(1);
    await p.click('wqc-fnext');
    expect(p.screen()).toBe('story-along');
    expect(m).toEqual([RA, 'play']);
  });
  test.each(['en', 'ur'])('%s: a counted read (no timings on the serve): the server says pending (409), the page asks again after 1 s, the Next becomes «Hear it again»', async (lang) => {
    const p = trail(lang, { fold: true, read: ZL, words: pendingThen(1) });
    player(p);
    await stopAtZero(p);
    await p.flush();
    expect(asks(p)).toHaveLength(1);
    expect(p.html()).not.toContain(REPLAY[lang]);
    await p.runTimers((x) => x.ms === 1000);
    await p.flush();
    expect(asks(p)).toHaveLength(2);
    expect(asks(p)[1].url).toMatch(/\/api\/wq\/ch\/words\/CT1\?lang=/);
    const h = kindCard(p, lang);
    expect(nexts(h)).toEqual(['id="wqc-fnext"']);
    expect(h).toContain(`>${REPLAY[lang]}</button>`);
    expect(primaries(h)).toBe(1);
  });
  test('the at-once card asks only after the recording has gone up (ch/upload, then ch/result, then ch/words)', async () => {
    const p = trail('en', { fold: true, read: ZL, words: pendingThen(0) });
    player(p);
    await stopAtZero(p);
    await p.flush();
    const words = at(p, /ch\/words\//);
    expect(words).toBeGreaterThan(-1);
    expect(words).toBeGreaterThan(at(p, /ch\/upload/));
    expect(words).toBeGreaterThan(at(p, /ch\/result/));
    expect(p.html()).toContain(`>${REPLAY.en}</button>`);
  });
  test('switch on: the recording starts up before the kind card is drawn', async () => {
    const p = trail('en', { fold: true, read: ZL, words: pendingThen(0) });
    player(p);
    await stopAtZero(p);
    await p.flush();
    expect(p.server.atUpload).toBeDefined();
    expect(p.server.atUpload).not.toBe('read-result');
    kindCard(p, 'en');
  });
  test('pending every time: asked again after about 1 s, 2 s and 4 s, then never again; the slot\'s tile stays the ONE Next', async () => {
    const p = trail('en', { fold: true, read: ZL, words: pendingThen(99) });
    player(p);
    await stopAtZero(p);
    await p.flush();
    for (const ms of [1000, 2000, 4000]) { await p.runTimers((x) => x.ms === ms); await p.flush(); }
    expect(asks(p)).toHaveLength(4);
    await p.runTimers((x) => x.ms <= 8000 && x.ms !== 3000);
    await p.flush();
    expect(asks(p)).toHaveLength(4);
    const h = kindCard(p, 'en');
    expect(h).not.toContain(REPLAY.en);
    expect(h).toContain('<a class="wq-btn wq-go" id="wqc-fnext" data-primary href="/s/b1/1">Read a storybook</a>');
    expect(primaries(h)).toBe(1);
  });
  test('the card is gone (the child went on): the page does not ask again', async () => {
    const p = trail('en', { fold: true, read: ZL, words: pendingThen(99) });
    player(p);
    await stopAtZero(p);
    await p.flush();
    expect(asks(p)).toHaveLength(1);
    p.w.open('read'); await p.flush();
    await p.runTimers((x) => x.ms === 1000);
    await p.flush();
    expect(asks(p)).toHaveLength(1);
  });
  // a slow check: the words call says pending (409) until the server's check of the recording has settled; the page
  // asks once more when that check comes back, while the card is still open
  const slowCheck = () => {
    const box = {};
    const words = () => (box.p && box.p.server.now.body && !box.p.server.now.body.pending ? { status: 200, body: { readalong: RA } } : { status: 409, body: { error: 'pending' } });
    return { box, words };
  };
  const polls = async (p, n) => { for (let i = 0; i < n; i += 1) { await p.runTimers((x) => x.ms === 3000); await p.flush(); } };
  test.each(['en', 'ur'])('%s: the check settles late (about 15 s, after the 1, 2 and 4 s asks): one more ask then, the Next becomes «Hear it again»', async (lang) => {
    const { box, words } = slowCheck();
    const p = trail(lang, { fold: true, read: ZL, words });
    box.p = p;
    player(p);
    await stopAtZero(p);
    await p.flush();
    for (const ms of [1000, 2000, 4000]) { await p.runTimers((x) => x.ms === ms); await p.flush(); }
    expect(asks(p)).toHaveLength(4);
    // the check is still running at 3, 6, 9 and 12 s: nothing more is asked
    await polls(p, 4);
    expect(asks(p)).toHaveLength(4);
    expect(p.html()).not.toContain(REPLAY[lang]);
    // it settles (nothing read) on the poll at 15 s
    p.server.now = { status: 200, body: SETTLED.implausible };
    await polls(p, 1);
    await p.flush();
    expect(asks(p)).toHaveLength(5);
    const h = kindCard(p, lang);
    expect(nexts(h)).toEqual(['id="wqc-fnext"']);
    expect(h).toContain(`>${REPLAY[lang]}</button>`);
    expect(primaries(h)).toBe(1);
    expect(homes(h)).toBe(1);
  });
  test('the check settles late, still pending when asked once more: asked again after 1, 2 and 4 s from then, then never again', async () => {
    const p = trail('en', { fold: true, read: ZL, words: pendingThen(99) });
    player(p);
    await stopAtZero(p);
    await p.flush();
    for (const ms of [1000, 2000, 4000]) { await p.runTimers((x) => x.ms === ms); await p.flush(); }
    await polls(p, 4);
    expect(asks(p)).toHaveLength(4);
    p.server.now = { status: 200, body: SETTLED.implausible };
    await polls(p, 1);
    expect(asks(p)).toHaveLength(5);
    for (const ms of [1000, 2000, 4000]) { await p.runTimers((x) => x.ms === ms); await p.flush(); }
    expect(asks(p)).toHaveLength(8);
    await p.runTimers(() => true); await p.flush();
    expect(asks(p)).toHaveLength(8);
    const h = kindCard(p, 'en');
    expect(h).toContain('<a class="wq-btn wq-go" id="wqc-fnext" data-primary href="/s/b1/1">Read a storybook</a>');
    expect(primaries(h)).toBe(1);
  });
  test('the check settles late after the child has left the card: nothing more is asked', async () => {
    const { box, words } = slowCheck();
    const p = trail('en', { fold: true, read: ZL, words });
    box.p = p;
    player(p);
    await stopAtZero(p);
    await p.flush();
    for (const ms of [1000, 2000, 4000]) { await p.runTimers((x) => x.ms === ms); await p.flush(); }
    await polls(p, 4);
    expect(asks(p)).toHaveLength(4);
    p.w.open('read'); await p.flush();
    p.server.now = { status: 200, body: SETTLED.implausible };
    await polls(p, 1);
    await p.runTimers((x) => x.ms === 1000 || x.ms === 2000 || x.ms === 4000); await p.flush();
    expect(asks(p)).toHaveLength(4);
  });
  test('no timings anywhere (the words call says 404): the slot\'s tile stays the ONE Next', async () => {
    const p = trail('en', { fold: true, read: ZL });
    player(p);
    await stopAtZero(p);
    await p.flush();
    const h = kindCard(p, 'en');
    // the host's Next link to the slot's offer (the card's own tile takes its place in the browser)
    expect(nexts(h)).toEqual(['id="wqc-fnext"']);
    expect(h).toContain('<a class="wq-btn wq-go" id="wqc-fnext" data-primary href="/s/b1/1">Read a storybook</a>');
    expect(h).not.toContain(REPLAY.en);
    expect(primaries(h)).toBe(1);
  });
  test('off the fold: no «Hear it again», no words call; "Try again" as built', async () => {
    const p = trail('en', { read: { ...ZL, hear_first: RA } });
    player(p);
    await stopAtZero(p);
    expect(p.html()).not.toContain(REPLAY.en);
    expect(asks(p)).toHaveLength(0);
    expect(p.has('wqc-again')).toBe(true);
  });
});

// Switch off (or anything but JSON true): the kind card as it is without the tile — its Next and Home — and the page
// never asks for the words of a read run, even with the timings on the serve.
describe('"Hear it again" switch off: no words call and no tile on the kind card', () => {
  const RA = { v: 1, id: 'p1', lang: 'en', audio: { url: 'https://r2.test/a.ogg', ms: 9000 }, words: [{ i: 0, t: 'Imran', s_ms: 0, e_ms: 400 }] };
  const REPLAY = { en: 'Hear it again', ur: 'دوبارہ سنیں' };
  const WORDS = { status: 200, body: { readalong: RA } };
  const player = (p) => { p.win.WQReadAlong = { mount: () => ({ play() {}, destroy() {} }) }; };
  test.each([
    ['absent', {}], ['the string "true"', { zero_listen: 'true' }], ['1', { zero_listen: 1 }], ['{}', { zero_listen: {} }], ['false', { zero_listen: false }],
  ])('%s: no ch/words call, no «Hear it again»; the slot\'s tile is the ONE Next, one Home (en + ur)', async (_, flag) => {
    for (const lang of ['en', 'ur']) {
      for (const read of [flag, { ...flag, hear_first: RA }]) {
        const p = trail(lang, { fold: true, read, words: WORDS });
        player(p);
        await stopAtZero(p);
        await p.flush();
        for (const ms of [1000, 2000, 4000]) await p.runTimers((x) => x.ms === ms);
        await p.flush();
        // the check settles late: still no words call
        p.server.now = { status: 200, body: SETTLED.implausible };
        for (let i = 0; i < 5; i += 1) { await p.runTimers((x) => x.ms === 3000); await p.flush(); }
        const h = kindCard(p, lang);
        expect(p.fetches.some((f) => /ch\/words/.test(f.url))).toBe(false);
        expect(h).not.toContain(REPLAY[lang]);
        expect(h).toMatch(/<a class="wq-btn wq-go" id="wqc-fnext" data-primary href="\/s\/b1\/1">/);
        expect(primaries(h)).toBe(1);
        expect(homes(h)).toBe(1);
      }
    }
  });
  test.each(['en', 'ur'])('%s, switch off: the kind card is drawn first, then the recording starts up (as before the switch)', async (lang) => {
    const p = trail(lang, { fold: true, words: WORDS });
    player(p);
    await stopAtZero(p);
    await p.flush();
    expect(p.server.atUpload).toBe('read-result');
    kindCard(p, lang);
  });
});
