'use strict';
/**
 * The sound check («کیا جگنو کی آواز آ رہی ہے؟» / "Can you hear Jugnu?", sa-ui.js sCheck) on the coach page's frame, under the
 * tier's WHOLE served switch set: both picture tiles whole and hit-testable at their centre, the replay and the
 * "I can't hear" button in reach, no inner scroll and no scroll cue, on a 360×640 phone (dpr 2 and 3) and on an
 * 800×1280 tablet, Urdu and English, coach-led and RDF auto, on the set a sandbox page is served today and on the
 * pre-round-28 set staging and production serve (the same set without the four r28 flags).
 *
 * Why this file: the sound check is the first screen a child meets. On a 360×640 phone the Urdu screen's body was a
 * scroller 80 px taller than the frame: the two pictures sat cut off under the fold, the round-9 "scroll down" cue was
 * drawn over them, and a five-year-old had to scroll before they could tap the picture Jugnu named. Every earlier fit
 * row measured a hand-picked subset of the switches; this one mounts the served `ui` verbatim
 * (fixtures/sa-served-ui.sandbox.json) and the pre-r28 set derived from it.
 *
 * A real browser lays the screen out (jsdom has none): skipped, never red, where there is no playwright-core
 * (PWCORE=<path>) or no chromium. SA_DIR=<dir> measures another engine tree (a tier's archived dashboard/sa) with the
 * same rows. Fixtures are the committed coach batteries; no network.
 */
const path = require('path');
const fs = require('fs');

let pwChromium = null;
try { ({ chromium: pwChromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const PW_EXE = process.env.PWCHROME_EXE || (pwChromium ? (() => { try { return pwChromium.executablePath(); } catch (_) { return null; } })() : null);
const maybe = pwChromium && PW_EXE && fs.existsSync(PW_EXE) ? describe : describe.skip;

const SA = process.env.SA_DIR ? path.resolve(process.env.SA_DIR) : path.join(__dirname, '..', 'sa');
const PUB = path.join(__dirname, '..', 'public', 'wq');
const SERVED_UI = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sa-served-ui.sandbox.json'), 'utf8'));
const PRE_UI = Object.fromEntries(Object.entries(SERVED_UI).filter(([k]) => !/^r28_/.test(k)));
const ON = { rdfW3Forms: true, oneAtATime: true };
const ON_R28 = Object.assign({}, ON, { r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true });
// the switch sets: the served set with sa_r28_check_fit ON (the bar), the served set as sandbox serves it today (OFF:
// today's screen, byte for byte) and the pre-round-28 set staging and prod serve (OFF: the same)
const SETS = [
  { name: 'on', ui: Object.assign({}, SERVED_UI, { r28_check_fit: true }), on: Object.assign({}, ON_R28, { r28CheckFit: true }), r28: true, fit: true },
  { name: 'off', ui: SERVED_UI, on: ON_R28, r28: true, fit: false },
  { name: 'pre_r28', ui: PRE_UI, on: ON, r28: false, fit: false },
];
const FRAMES = [
  { name: 'phone2', vp: { width: 360, height: 640 }, dpr: 2 },
  { name: 'phone3', vp: { width: 360, height: 640 }, dpr: 3 },
  { name: 'tablet', vp: { width: 800, height: 1280 }, dpr: 1.5 },
];
const MODES = [{ name: 'coach', manual: true }, { name: 'auto', manual: false }];

/** The coach battery of `lang` (grade 2, Set A) as the route serves it, with the set's `ui`. */
function battery(lang, set) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${lang}.json`), 'utf8'));
  const b = applySwitches(raw, set.on);
  const bat = Object.assign({}, b, { ui: Object.assign({}, set.ui) });
  delete bat.rdf_auto; delete bat.rdf_manual;
  return bat;
}

function html(lang, mode, set) {
  const bat = battery(lang, set);
  // the coach page's corner hold over the frame (AssessEngineSlot: fixed top-2 start-2, gap-2, min-h 48): End test, and
  // in a coach-led run End this section too
  const hold = (lang === 'ur' ? ['جائزہ ختم (کوچ)', 'یہ حصہ ختم کریں'] : ['End test (coach)', 'End this section']).slice(0, mode.manual ? 2 : 1);
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0;
  var cur = null;
  function speak(text, audio, vo) {
    if (!(vo && vo.clip_only)) return Promise.resolve();
    var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5; a.duration = 1;
    var line = { a: a }; cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; });
  }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  var battery = ${JSON.stringify(bat)};
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: ${mode.manual}, one_at_a_time: true, audio_check: true, warmup: true });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${mode.manual}, handover: false, ur_fit: true,
    ${set.r28 ? 'r28: { letter_pick: true, mcq: true, ceiling: true }, ' : ''}speak: speak, embed: true });
  runner.start(); view.render();
  view.setSync({ state: 'synced' });
  (function () {
    var hb = document.createElement('div'); hb.id = 'hold'; hb.setAttribute('dir', '${lang === 'ur' ? 'rtl' : 'ltr'}');
    hb.style.cssText = 'position:fixed;top:8px;inset-inline-start:8px;display:flex;gap:8px;z-index:1001;font:600 12px/16px system-ui,sans-serif';
    ${JSON.stringify(hold)}.forEach(function (t) { var b = document.createElement('button'); b.textContent = t; b.style.cssText = 'min-height:48px;min-width:48px;padding:4px 12px;border:1px solid #cbd5e1;border-radius:12px;background:rgba(255,255,255,.9);font:inherit'; hb.appendChild(b); });
    document.body.appendChild(hb);
  }());
  window.__view = view; window.__runner = runner;
</script></body></html>`;
}

/** In the page: the tiles, the replay and the foot button hit at their centres inside the viewport; every scroll box's overflow. */
const measure = () => document.fonts.ready.then(() => {
  const vh = window.innerHeight;
  const R = (e) => { const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const hits = (k) => { const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!e && (e === k || k.contains(e)); };
  const whole = (k) => { const b = k.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh && b.left >= 0 && b.right <= window.innerWidth; };
  const over = (n) => (n ? Math.max(0, +(n.scrollHeight - n.clientHeight).toFixed(1)) : 0);
  const scr = document.querySelector('.sae-screen');
  const body = scr && scr.querySelector('.sae-body');
  const cueAll = Array.from(document.querySelectorAll('.sae-r9-scroll'));
  const cue = cueAll.find((c) => !c.hidden && getComputedStyle(c).display !== 'none');
  // the overflow with the cue hidden (the cue is drawn because the box overflows, and then takes room of its own)
  const was = cueAll.map((c) => c.hidden); cueAll.forEach((c) => { c.hidden = true; });
  const trueOver = { body: over(body), screen: over(scr) };
  cueAll.forEach((c, i) => { c.hidden = was[i]; });
  const hb = document.getElementById('hold'); const a = hb && hb.getBoundingClientRect();
  const meets = (k) => { const b = k.getBoundingClientRect(); return !!a && b.width > 0 && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; };
  const v = window.__runner.view();
  return {
    vh, phase: v.phase, screen_cls: scr ? String(scr.className) : null,
    pad_top: scr ? parseFloat(getComputedStyle(scr).paddingTop) : null,
    body_mode: body ? getComputedStyle(body).overflowY : null, body_over: over(body), screen_over: over(scr),
    page_over: Math.max(0, document.documentElement.scrollHeight - vh), true_over: trueOver,
    pics: Array.from(document.querySelectorAll('.sae-check .sae-pic')).map((k) => Object.assign(R(k), { whole: whole(k), hit: hits(k) })),
    replay: (() => { const k = document.querySelector('.sae-check .sae-replay'); return k ? Object.assign(R(k), { whole: whole(k), hit: hits(k) }) : null; })(),
    jugnu: (() => { const k = document.querySelector('.sae-check .sae-jugnu'); return k ? R(k) : null; })(),
    foot: Array.from(document.querySelectorAll('.sae-check .sae-foot button')).map((k) => Object.assign(R(k), { text: k.textContent.trim(), whole: whole(k), hit: hits(k) })),
    cue: cue ? R(cue) : null,
    hold_hits: Array.from(document.querySelectorAll('.sae-check button')).filter(meets).map((k) => k.textContent.trim() || String(k.className)),
    // the screen's blocks top to bottom (where the height goes)
    layout: scr ? [scr].concat(Array.from(scr.children), body ? Array.from(body.children) : []).map((n) => ({ cls: String(n.className).split(' ').slice(0, 2).join('.'), top: +n.getBoundingClientRect().top.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1) })) : null,
  };
});

maybe('the sound check under the served switch set: both pictures, the replay and "I can\'t hear" in reach, no scroll, phone and tablet, UR and EN, coach-led and RDF auto', () => {
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  async function walk(lang, mode, fr, set) {
    const ctx = await browser.newContext({ viewport: fr.vp, deviceScaleFactor: fr.dpr });
    const p = await ctx.newPage();
    const doc = html(lang, mode, set);
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
      if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
      if (u.pathname === '/') return route.fulfill({ body: doc, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(600); // the question is said, then the target's clip starts
    const tag = `${set.name}_${lang}_${fr.name}_${mode.name}`;
    const shot = async (name) => { if (process.env.SA_CHECK_SHOT_DIR) await p.screenshot({ path: path.join(process.env.SA_CHECK_SHOT_DIR, `check_${name}_${tag}.png`) }); };
    const rows = [];
    rows.push(Object.assign({ state: 'asked' }, await p.evaluate(measure)));
    await shot('asked');
    await p.evaluate(() => window.__end());
    await p.waitForTimeout(250);
    rows.push(Object.assign({ state: 'aftersound' }, await p.evaluate(measure)));
    // "I can't hear": the headphones screen, then Retry back to the question
    await p.evaluate(() => { const b = document.querySelector('.sae-check .sae-foot button'); b.click(); });
    await p.waitForTimeout(250);
    rows.push(Object.assign({ state: 'bad' }, await p.evaluate(measure)));
    await shot('bad');
    await ctx.close();
    if (process.env.SA_CHECK_LOG) fs.appendFileSync(process.env.SA_CHECK_LOG, JSON.stringify({ set: set.name, lang, frame: fr.name, mode: mode.name, sa_dir: SA, rows }) + '\n');
    return rows;
  }
  /** The bar, one row per state: both tiles whole and hit, the replay hit, every foot button whole and hit with its
   *  foot 8 px clear of the edge, no scroll box overflowing, no cue, nothing of the screen under the coach's hold. */
  const bar = (r) => ({
    state: r.state, phase: r.phase, pics: r.pics.length, pics_whole: r.pics.filter((k) => k.whole).length, pics_hit: r.pics.filter((k) => k.hit).length,
    replay_hit: r.replay ? r.replay.hit : null, foot: r.foot.map((b) => ({ text: b.text, whole: b.whole && b.bottom <= r.vh - 8, hit: b.hit })),
    body_over: r.body_over, screen_over: r.screen_over, page_over: r.page_over, cue: !!r.cue, hold_hits: r.hold_hits,
  });
  const want = (r) => ({
    state: r.state, phase: 'audio_check', pics: r.state === 'bad' ? 0 : 2, pics_whole: r.state === 'bad' ? 0 : 2, pics_hit: r.state === 'bad' ? 0 : 2,
    replay_hit: r.state === 'bad' ? null : true, foot: r.foot.map((b) => ({ text: b.text, whole: true, hit: true })),
    body_over: 0, screen_over: 0, page_over: 0, cue: false, hold_hits: [],
  });

  /** OFF on a 360×640 Urdu phone = today's screen: the body a scroller 151 px taller than its box (80 without the cue
   *  it draws), the cue drawn, neither tile tappable; every other cell meets the bar OFF as it does today. */
  const today = (r) => (r.state === 'bad' ? null : { state: r.state, body_mode: r.body_mode, body_over: r.body_over, true_body: r.true_over.body, cue: !!r.cue, pics_hit: r.pics.filter((k) => k.hit).length, foot_hit: r.foot.filter((b) => b.hit).length });
  const TODAY = (s) => ({ state: s, body_mode: 'auto', body_over: 151, true_body: 80, cue: true, pics_hit: 0, foot_hit: 1 });

  for (const set of SETS) for (const fr of FRAMES) for (const mode of MODES) for (const lang of ['ur', 'en']) {
    const urPhone = lang === 'ur' && fr.vp.height < 700;
    if (set.fit || !urPhone) {
      test(`[${set.name}] ${lang} ${fr.name} (${fr.vp.width}×${fr.vp.height} dpr ${fr.dpr}) ${mode.name}: asked, after the sound, "I can't hear" — all in reach, nothing scrolls`, async () => {
        const rows = await walk(lang, mode, fr, set);
        expect(rows.map(bar)).toEqual(rows.map(want));
      }, 60000);
    } else {
      test(`[${set.name}] ${lang} ${fr.name} (${fr.vp.width}×${fr.vp.height} dpr ${fr.dpr}) ${mode.name}: OFF is today's screen (body 151 over, 80 without the cue, the cue drawn, no tile tappable)`, async () => {
        const rows = await walk(lang, mode, fr, set);
        expect(rows.map(today).filter(Boolean)).toEqual(['asked', 'aftersound'].map(TODAY));
      }, 60000);
    }
  }
});
