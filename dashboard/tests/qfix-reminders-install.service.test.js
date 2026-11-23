/**
 * The add-to-home-screen card (web_quiz_install_prompt, the hub's `play.install`) and its meter.
 *  - door_shown{install} is counted only with web_quiz_events_v2 on (no production row), so the card had no meter.
 *    install_prompt {step, src, reason} rides the relay's general props and is logged without it.
 *  - Chrome fires beforeinstallprompt once per page. On real phones it comes after the hub renders, which the card's
 *    own listener hears; when it comes before (about 10 ms after `load`, before that listener exists), the page head
 *    keeps it (BIP_CAPTURE, written with the manifest link) and hub-play.js takes it from there.
 *  - The render-time hub{reason} is logged before the offer, so it cannot say whether the card showed: each hub view
 *    also logs ONE install_prompt{step:'outcome', reason, when} (shown, or why not), so views partition.
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');

const PLAY_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub-play.js'), 'utf8');
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const WA_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 WhatsApp/2.24';
const NOW = Date.parse('2026-11-21T13:00:00Z');
const TODAY = String(Math.floor((NOW + 5 * 3600000) / 86400000));
const NO_V2 = { first: false, lantern: null, shelf: [], install: true, doors: [] }; // production today: events_v2 off

// hub-play.js in a page. opts.early: the offer the head kept before this script loaded (window.__wqBip).
function page({ store = {}, ua = CHROME_UA, early = null, tour = null, now = () => NOW, wqt = null, app = false, slot = null } = {}) {
  const winL = {}; const docL = {}; const timers = []; const doc = { visibilityState: 'visible' };
  const box = { innerHTML: '', ls: {}, addEventListener(n, fn) { (box.ls[n] = box.ls[n] || []).push(fn); } };
  // slot: {on} — the card's slot is on the page only while on (the home drawn again, or not yet drawn)
  const ROOT = { innerHTML: '<div id="wqp-inst" class="wq-inst"></div>', querySelector: (s) => (s === '#wqp-inst' && (!slot || slot.on) ? box : null) };
  const win = { addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); }, matchMedia: () => ({ matches: app }) };
  if (early) win.__wqBip = early;
  if (tour) win.WQW = { up: () => tour.up };
  if (wqt) win.WQT = wqt;
  const ctx = {
    window: win, navigator: { userAgent: ua },
    document: { head: { appendChild() {} }, createElement: () => ({}), get visibilityState() { return doc.visibilityState; }, addEventListener(n, fn) { (docL[n] = docL[n] || []).push(fn); } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, Date: class extends Date { static now() { return now(); } },
    JSON, Math, String, Number, Array, Object, isFinite, encodeURIComponent, Boolean,
  };
  vm.createContext(ctx);
  vm.runInContext(PLAY_SRC, ctx);
  const evs = [];
  const flush = () => { while (timers.length) timers.shift()(); };
  const tick = () => { const t = timers.splice(0); t.forEach((fn) => fn()); };
  return {
    box, evs,
    // Chrome's offer, heard by whatever is listening on the window right now
    offer(e) { (winL.beforeinstallprompt || []).forEach((fn) => fn(e)); flush(); },
    // the same, then one round of timers only: under the tour the card re-checks every second, so draining would not end
    offerOnce(e) { (winL.beforeinstallprompt || []).forEach((fn) => fn(e)); tick(); },
    // the hub renders and hands the slot over (wq-home.js mount → WQPLAY.install)
    render(play = NO_V2, extra = {}) { win.WQPLAY.install({ lang: 'en', play, ...extra }, (n, p) => evs.push([n, p]), ROOT, { h3: true }); tick(); },
    tick,
    click(what) { box.ls.click.forEach((fn) => fn({ target: { getAttribute: (k) => (k === 'data-inst' ? what : null) } })); },
    // the page goes to the background or closes: visibilitychange to hidden, then pagehide
    hide() { doc.visibilityState = 'hidden'; (docL.visibilitychange || []).forEach((fn) => fn({})); (winL.pagehide || []).forEach((fn) => fn({})); },
    show() { doc.visibilityState = 'visible'; (docL.visibilitychange || []).forEach((fn) => fn({})); },
    // the card's steps (the view's outcome is read with outcomes())
    steps: () => evs.filter(([n, p]) => n === 'install_prompt' && p.step !== 'outcome').map(([, p]) => p),
    outcomes: () => evs.filter(([n, p]) => n === 'install_prompt' && p.step === 'outcome').map(([, p]) => p),
  };
}
const bip = (outcome = 'accepted') => {
  const e = { prevented: 0, prompted: 0, preventDefault() { e.prevented += 1; }, prompt() { e.prompted += 1; }, userChoice: { then(fn) { fn({ outcome }); } } };
  return e;
};

describe('the offer comes before the hub renders (what a phone Chrome already trusts does)', () => {
  test('kept by the head (window.__wqBip): the card fills on a later view of the day', () => {
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip() });
    p.render();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
  });
  test('the old wiring alone (no head store): an offer before the render is lost (the early-offer case the head catches)', () => {
    const p = page({ store: { wqp_hv_day: TODAY } });
    p.offer(bip()); // nobody listening yet: Chrome does not fire it again
    p.render();
    expect(p.box.innerHTML).toBe('');
    expect(p.steps()[0]).toEqual({ step: 'hub', src: 'browser', reason: 'no_bip' });
  });
  test('an offer after the render (its own listener, as before) holds Chrome\'s banner back and fills the card', () => {
    const p = page({ store: { wqp_hv_day: TODAY } });
    p.render();
    const e = bip();
    p.offer(e);
    expect(e.prevented).toBe(1);
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
  });
  test('the head\'s event heard again by its own listener: adopted once, one card_shown', () => {
    const e = bip();
    const p = page({ store: { wqp_hv_day: TODAY }, early: e });
    p.render();
    p.offer(e);
    expect(p.steps().filter((s) => s.step === 'card_shown')).toHaveLength(1);
  });
  test('the head\'s store never holds Chrome\'s own banner back', () => {
    const e = bip();
    page({ store: { wqp_hv_day: TODAY }, early: e }).render();
    expect(e.prevented).toBe(0);
  });
  test('the day\'s first view still shows no card', () => {
    const p = page({ store: {}, early: bip() });
    p.render();
    expect(p.box.innerHTML).toBe('');
  });
});

describe('install_prompt is logged with web_quiz_events_v2 off (doors: [])', () => {
  test('first view: hub{first_view}, bip_fired{before_render}; no door_shown', () => {
    const p = page({ store: {}, early: bip() });
    p.render();
    expect(p.steps()).toEqual([
      { step: 'hub', src: 'browser', reason: 'first_view' },
      { step: 'bip_fired', src: 'browser', reason: 'before_render' },
    ]);
    expect(p.evs.filter(([n]) => n === 'door_shown')).toEqual([]);
  });
  test('a later view, then Add, accepted: hub{ready}, bip_fired, card_shown, add, accepted', () => {
    const e = bip('accepted');
    const p = page({ store: { wqp_hv_day: TODAY }, early: e });
    p.render();
    p.click('add');
    expect(e.prompted).toBe(1);
    expect(p.steps().map((s) => s.step + (s.reason ? ':' + s.reason : ''))).toEqual(['hub:ready', 'bip_fired:before_render', 'card_shown', 'add', 'accepted']);
  });
  test('no offer yet: hub{no_bip}; the offer after the render: bip_fired{after_render}, card_shown', () => {
    const p = page({ store: { wqp_hv_day: TODAY } });
    p.render();
    expect(p.box.innerHTML).toBe('');
    p.offer(bip());
    expect(p.steps().map((s) => s.step + (s.reason ? ':' + s.reason : ''))).toEqual(['hub:no_bip', 'bip_fired:after_render', 'card_shown']);
  });
  test('Not now, then dismissed in Chrome\'s dialog: later / dismissed', () => {
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip() });
    p.render();
    p.click('later');
    expect(p.steps().map((s) => s.step)).toContain('later');
    const q = page({ store: { wqp_hv_day: TODAY }, early: bip('dismissed') });
    q.render();
    q.click('add');
    expect(q.steps().map((s) => s.step)).toContain('dismissed');
  });
  test('snoozed (Not now within 7 days): hub{snoozed}', () => {
    const p = page({ store: { wqp_hv_day: TODAY, wqp_inst_later: String(NOW - 86400000) }, early: bip() });
    p.render();
    expect(p.steps()[0]).toEqual({ step: 'hub', src: 'browser', reason: 'snoozed' });
  });
  test('WhatsApp\'s own browser: hub{iab}, no card', () => {
    const p = page({ ua: WA_UA, early: bip() });
    p.render();
    expect(p.steps()).toEqual([{ step: 'hub', src: 'iab', reason: 'iab' }]);
    expect(p.box.innerHTML).toBe('');
  });
  test('switch off (no play.install): nothing logged', () => {
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip() });
    p.render({ ...NO_V2, install: false });
    expect(p.evs).toEqual([]);
  });
});

describe('the head keeps the offer, written only with the manifest', () => {
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  const HUB = (extra = {}) => ({ lang: 'en', brand: 'niete', kids: [{ kid: '0123456789abcdef', name: 'Test Child' }], kid: '0123456789abcdef', ...extra });
  const CAPTURE = '<script>addEventListener("beforeinstallprompt",function(e){window.__wqBip=e})</script>\n<link rel="manifest"';
  test('server render with play.install: the store sits right before the manifest link', () => {
    const html = R.renderHubPage({ payload: HUB({ play: { install: true, doors: [] } }), token: TOKEN, origin: 'https://portal.example', assetV: 'v1' });
    expect(html).toContain(CAPTURE);
    expect(html.indexOf('beforeinstallprompt')).toBeLessThan(html.indexOf('</head>'));
  });
  test('switch off: no store, no manifest (the page is today\'s)', () => {
    const html = R.renderHubPage({ payload: HUB(), token: TOKEN, origin: 'https://portal.example', assetV: 'v1' });
    expect(html).not.toContain('beforeinstallprompt');
    expect(html).not.toContain('rel="manifest"');
  });

  // the fast first page (web_quiz_fast): the manifest rides the tail's corrections; the store goes in just before it
  const BOT = 'http://bot.test';
  const jsonRes = (body) => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
  const get = (srv, p) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: p, headers: { host: 'portal.example', 'accept-language': 'en' } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b));
    });
    r.on('error', reject); r.end();
  });
  test('fast first page: the tail writes the store, then the manifest link', async () => {
    const answer = HUB({ fast: true, play: { install: true, doors: [] } });
    const app = express();
    app.set('trust proxy', 1);
    const answers = [jsonRes(answer), jsonRes(answer)];
    app.use(R.createWebQuizRouter({ botUrl: BOT, apiKey: 'test-internal-key', fetchImpl: () => Promise.resolve(answers.shift()) }));
    const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      await get(srv, `/h/${TOKEN}`);            // the edge learns `fast` from this answer
      const body = await get(srv, `/h/${TOKEN}`); // flushed: head + frame now, the tail when the bot answers
      const at = body.indexOf('window.__wqBip=e');
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(body.indexOf('m.rel="manifest"'));
    } finally { await new Promise((r) => srv.close(r)); }
  });
});

// COS 173824: on a new child's second view the card was drawn UNDER the first-run tour (wq-welcome.js) and could not be
// tapped. The card waits until the tour is done or skipped (WQW.up() false), keeping the offer.
describe('the card never sits under the first-run tour', () => {
  test('tour up: no card (hub{tour}); tour ends: the card fills', () => {
    const tour = { up: true };
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip(), tour });
    p.render(NO_V2, { welcome: { v: 1 } });
    expect(p.box.innerHTML).toBe('');
    expect(p.steps()[0]).toEqual({ step: 'hub', src: 'browser', reason: 'tour' });
    p.tick(); p.tick();
    expect(p.box.innerHTML).toBe('');
    tour.up = false;
    p.tick();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
  });
  test('a tour the answer promises but has not drawn yet: wait for it, then fill after it ends', () => {
    const tour = { up: false };
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip(), tour });
    p.render(NO_V2, { welcome: { v: 1 } });
    expect(p.box.innerHTML).toBe('');
    tour.up = true; p.tick();
    expect(p.box.innerHTML).toBe('');
    tour.up = false; p.tick();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
  });
  test('a promised tour that never shows (its script failed): the card after 30 s', () => {
    let t = NOW;
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip(), now: () => t });
    p.render(NO_V2, { welcome: { v: 1 } });
    expect(p.box.innerHTML).toBe('');
    t = NOW + 31000; p.tick();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
  });
  test('no tour in the answer: the card at once, as before', () => {
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip() });
    p.render();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
  });
});

// The render-time hub{reason} comes before Chrome's offer (after the render on nearly every real phone), so a view that
// later shows the card, or holds it under the tour, still reads no_bip there. ONE outcome per hub view says what the
// view ended as: decided at render when it cannot change (app, iab, first_view, snoozed), when the card is drawn
// (shown; held:'tour' when the tour held it first), or when the page is hidden (no_bip, tour).
describe('one outcome per hub view', () => {
  const O = (reason, when, extra = {}) => ({ step: 'outcome', src: 'browser', reason, when, ...extra });
  test('tour up, the offer after the render, the tour ends: shown, held by the tour', () => {
    const tour = { up: true };
    const p = page({ store: { wqp_hv_day: TODAY }, tour });
    p.render(NO_V2, { welcome: { v: 1 } });
    p.offerOnce(bip());
    expect(p.box.innerHTML).toBe('');
    tour.up = false; p.tick();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
    p.hide();
    expect(p.outcomes()).toEqual([O('shown', 'tour_end', { held: 'tour' })]);
  });
  test('tour up, the offer after the render, the child leaves before the tour ends: tour', () => {
    const p = page({ store: { wqp_hv_day: TODAY }, tour: { up: true } });
    p.render(NO_V2, { welcome: { v: 1 } });
    p.offerOnce(bip());
    p.hide();
    expect(p.outcomes()).toEqual([O('tour', 'hide')]);
    expect(p.steps().map((s) => s.step)).not.toContain('card_shown');
  });
  test('no offer before the page is hidden: no_bip', () => {
    const p = page({ store: { wqp_hv_day: TODAY } });
    p.render();
    expect(p.outcomes()).toEqual([]);
    p.hide();
    expect(p.outcomes()).toEqual([O('no_bip', 'hide')]);
  });
  test('the offer after the render, no tour: shown on the offer (the hub row still says no_bip)', () => {
    const p = page({ store: { wqp_hv_day: TODAY } });
    p.render();
    p.offer(bip());
    expect(p.steps()[0]).toEqual({ step: 'hub', src: 'browser', reason: 'no_bip' });
    expect(p.outcomes()).toEqual([O('shown', 'offer')]);
  });
  test('the offer kept by the head, no tour: shown at render', () => {
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip() });
    p.render();
    expect(p.outcomes()).toEqual([O('shown', 'render')]);
  });
  test('the day\'s first view: first_view at render, once, whatever follows', () => {
    const p = page({ store: {}, early: bip() });
    p.render();
    p.offer(bip());
    p.hide();
    expect(p.outcomes()).toEqual([O('first_view', 'render')]);
  });
  test('snoozed: snoozed at render', () => {
    const p = page({ store: { wqp_hv_day: TODAY, wqp_inst_later: String(NOW - 86400000) }, early: bip() });
    p.render();
    expect(p.outcomes()).toEqual([O('snoozed', 'render')]);
  });
  test('WhatsApp\'s own browser: iab at render; an installed app: app at render', () => {
    const p = page({ ua: WA_UA, early: bip() });
    p.render();
    expect(p.outcomes()).toEqual([{ step: 'outcome', src: 'iab', reason: 'iab', when: 'render' }]);
    const q = page({ app: true, early: bip() });
    q.render();
    expect(q.outcomes()).toEqual([{ step: 'outcome', src: 'app', reason: 'app', when: 'render' }]);
  });
  test('hidden, back, hidden again: still one outcome', () => {
    const p = page({ store: { wqp_hv_day: TODAY } });
    p.render();
    p.hide(); p.show(); p.offer(bip()); p.hide();
    expect(p.outcomes()).toEqual([O('no_bip', 'hide')]);
  });
  test('on hide the page-session queue is sent at once (the outcome is not left in it)', () => {
    const wqt = { flush: jest.fn() };
    const p = page({ store: { wqp_hv_day: TODAY }, wqt });
    p.render();
    p.hide();
    expect(p.outcomes()).toHaveLength(1);
    expect(wqt.flush).toHaveBeenCalledWith(true);
  });
  test('switch off (no play.install): no outcome either', () => {
    const p = page({ store: { wqp_hv_day: TODAY }, early: bip() });
    p.render({ ...NO_V2, install: false });
    p.hide();
    expect(p.evs).toEqual([]);
  });
});

// The slot off the page when Chrome offers (the screen before the offer was not the home on 22 of 23 such views): the
// offer is kept and the card is drawn as soon as the slot is back, for up to a minute; after that the view is no_slot.
describe('an offer while the card\'s slot is off the page', () => {
  const O = (reason, when) => ({ step: 'outcome', src: 'browser', reason, when });
  test('the slot comes back without a new install(): the card is drawn then, shown', () => {
    const slot = { on: true };
    const p = page({ store: { wqp_hv_day: TODAY }, slot });
    p.render();
    slot.on = false;
    p.offerOnce(bip());
    expect(p.box.innerHTML).toBe('');
    slot.on = true;
    p.tick();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
    expect(p.outcomes()).toEqual([O('shown', 'offer')]);
  });
  test('the slot is not back within a minute: no card, no_slot on hide', () => {
    let t = NOW;
    const slot = { on: true };
    const p = page({ store: { wqp_hv_day: TODAY }, slot, now: () => t });
    p.render();
    slot.on = false;
    p.offerOnce(bip());
    for (let s = 0; s < 62; s += 1) { t += 1000; p.tick(); }
    slot.on = true;
    t += 1000; p.tick();
    expect(p.box.innerHTML).toBe('');
    p.hide();
    expect(p.outcomes()).toEqual([O('no_slot', 'hide')]);
  });
  test('the home hands a new slot through install(): drawn, as before', () => {
    const slot = { on: false };
    const p = page({ store: { wqp_hv_day: TODAY }, slot });
    p.render();
    p.offerOnce(bip());
    slot.on = true;
    p.render();
    expect(p.box.innerHTML).toContain('Add Jugnu to your home screen');
  });
});
