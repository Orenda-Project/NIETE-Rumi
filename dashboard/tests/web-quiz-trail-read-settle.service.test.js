/**
 * The Trail (v2) result card after a live reading waits for the server's result before it draws any button that the
 * result could change: until the result settles the card shows the line from the words heard and the shipped
 * listening line, with no questions button and no "try again" button (Home stays only when it is the same in both
 * results). When the server answers, the settled card draws its buttons once; a drawn button is never replaced.
 * The page runs whole in a vm (wqc-page-harness.js) with wq-read-live.js and wq-trail.js loaded before it; only the
 * browser (DOM, media, a fake Soniox WebSocket) and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const Bank = require('../../bot/shared/services/child-test/item-bank');

const LIVE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-read-live.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8');
const EN = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story;
const UR = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' }).story;
const STORY = (lang) => (lang === 'ur' ? UR : EN);
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt-rt.soniox.test/transcribe-websocket', model: 'stt-rt-v5' };
const TC = { stopDone: 'Stop done!', badge: 'Done', next: 'Next', mic: 'uses the microphone' };
const V2 = { pool: true, story: false };
const MENU = (lang) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, v2: V2, exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }] });
const READ = (lang, extra) => {
  const s = STORY(lang);
  return { ex: 'read', ct: 'CT1', secs: 60, live: true, lang, clips: H.CLIPS, record: true, trail: true, trail_copy: TC, v2: V2,
    story: { text: s.text, tokens: s.tokens, lines: s.lines, dir: lang === 'ur' ? 'rtl' : 'ltr' }, ...extra };
};
const PENDING = { status: 200, body: { pending: true } };
const HEARD = { status: 200, body: { score: { correct: 50, attempted: 54, stopped: false }, wcpm: 50 } };
const UNHEARD = { status: 200, body: { failed: true, reason: 'unheard' } };
const toks = (words) => words.map((w, k) => ({ text: (k === 0 ? '' : ' ') + w, start_ms: k * 1000, end_ms: k * 1000 + 800, is_final: true }));

class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; this.bufferedAmount = 0; FakeSocket.all.push(this); }
  send(x) { this.sent.push(x); }
  close() { this.closed = true; }
  open() { if (this.onopen) this.onopen({}); }
  msg(m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
}

// the result route answers from `server.now` (the first call and every poll), so a test decides when it settles
function trail(lang, { readExtra = {}, upload = null } = {}) {
  FakeSocket.all = [];
  const server = { now: PENDING };
  const p = H.page({ lang, menu: MENU(lang), freshEls: true, pre: [LIVE_SRC, TRAIL_SRC], routes: {
    'ch/HUB.TOKEN/read': H.ok(READ(lang, readExtra)),
    'ch/live': H.ok({ ...KEY, lang }),
    'ch/upload': upload || H.ok({ put_url: 'https://r2.test/put/abc', key: 'child-voice/sandbox/r/read-1.webm', content_type: 'audio/webm' }),
    'r2.test/put': () => ({ status: 200, body: {} }),
    'ch/result': () => server.now,
  } });
  p.win.WebSocket = FakeSocket;
  p.server = server;
  return p;
}
const readAll = async (p, lang, words) => {
  p.w.open('read'); await p.flush();
  await p.click('wqc-help-no');
  await p.click('wqc-go');
  const s = FakeSocket.all[0]; s.open();
  s.msg({ tokens: toks(words || STORY(lang).tokens) });
  await p.click('wqc-stop');
  s.msg({ tokens: [], finished: true });
  await p.flush();
};
// every button on the card, as drawn (id + label + class)
const buttons = (p) => p.root.innerHTML.match(/<button[^>]*>[^<]*<\/button>/g) || [];
const ids = (p) => buttons(p).map((b) => /id="([^"]+)"/.exec(b)[1]);
const listening = (p, lang) => p.w.T[lang].listening;

describe('a live Trail read: the first card waits for the server before its buttons', () => {
  test.each(['en', 'ur'])('%s: before the server answers → no questions, no again button; the listening line shows', async (lang) => {
    const p = trail(lang, { readExtra: { questions_on: true } });
    await readAll(p, lang);
    expect(p.screen()).toBe('read-result');
    expect(p.has('wqc-qa')).toBe(false);
    expect(p.has('wqc-again')).toBe(false);
    // with the questions on, Home differs between the two results (soft beside the questions, or alone): held too
    expect(ids(p)).toEqual([]);
    expect(p.html()).toContain(listening(p, lang));
    expect(p.html()).toContain('id="wqc-listening"');
  });

  test.each(['en', 'ur'])('%s: the server answers heard → the questions button appears once, never replaced after', async (lang) => {
    const p = trail(lang, { readExtra: { questions_on: true } });
    await readAll(p, lang);
    expect(p.has('wqc-qa')).toBe(false);
    p.server.now = HEARD;
    await p.runTimers();
    expect(p.screen()).toBe('read-result');
    expect(ids(p)).toEqual(['wqc-qa', 'wqc-menu']);
    expect(p.html()).not.toContain(listening(p, lang));
    const settled = p.root.innerHTML;
    // nothing else redraws it
    await p.runTimers(); await p.runTimers();
    expect(p.root.innerHTML).toBe(settled);
  });

  test.each(['en', 'ur'])('%s: the server answers not heard → the again button appears once; no questions button ever drawn', async (lang) => {
    const p = trail(lang, { readExtra: { questions_on: true } });
    await readAll(p, lang);
    expect(p.has('wqc-qa')).toBe(false);
    p.server.now = UNHEARD;
    await p.runTimers();
    expect(p.has('wqc-again')).toBe(true);
    expect(p.has('wqc-qa')).toBe(false);
    expect(p.html()).not.toContain(listening(p, lang));
    const settled = p.root.innerHTML;
    await p.runTimers();
    expect(p.root.innerHTML).toBe(settled);
  });

  test('the first answer (no poll) settles it: heard → the questions button at once', async () => {
    const p = trail('en', { readExtra: { questions_on: true } });
    p.server.now = HEARD;
    await readAll(p, 'en');
    expect(ids(p)).toEqual(['wqc-qa', 'wqc-menu']);
    expect(p.html()).not.toContain(listening(p, 'en'));
  });

  test('questions off: Home is the same in both results, so it stays, drawn exactly as the settled card draws it', async () => {
    const p = trail('en');
    await readAll(p, 'en');
    const held = buttons(p);
    expect(ids(p)).toEqual(['wqc-menu']);
    expect(p.html()).toContain(listening(p, 'en'));
    p.server.now = UNHEARD;
    await p.runTimers();
    const after = buttons(p);
    expect(after[0]).toBe(held[0]);
    expect(ids(p)).toEqual(['wqc-menu', 'wqc-again']);
  });

  test('the server never answers (the poll ends) → the card settles from the live count, buttons drawn once', async () => {
    const p = trail('en', { readExtra: { questions_on: true } });
    await readAll(p, 'en');
    for (let i = 0; i < 25; i += 1) await p.runTimers();
    expect(ids(p)).toEqual(['wqc-qa', 'wqc-menu']);
    expect(p.html()).not.toContain(listening(p, 'en'));
  });

  test('the recording cannot go up (an error) → the card settles from the live count', async () => {
    const p = trail('en', { readExtra: { questions_on: true }, upload: () => ({ status: 500, body: { error: 'x' } }) });
    await readAll(p, 'en');
    expect(ids(p)).toEqual(['wqc-qa', 'wqc-menu']);
    expect(p.html()).not.toContain(listening(p, 'en'));
  });

  test('golden: a reading not live (upload → listening wait → result) draws its result card at once, no listening line', async () => {
    const p = trail('en', { readExtra: { live: false, questions_on: true } });
    p.server.now = HEARD;
    p.w.open('read'); await p.flush();
    await p.click('wqc-help-no');
    await p.click('wqc-go');
    await p.click('wqc-stop');
    await p.flush();
    expect(p.screen()).toBe('read-result');
    expect(ids(p)).toEqual(['wqc-qa', 'wqc-menu']);
    expect(p.has('wqc-listening')).toBe(false);
  });
});
