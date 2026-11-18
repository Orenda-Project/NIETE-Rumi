'use strict';
/**
 * Round 28 (sa_r28_letter_pick), the letter picker's PRACTICE screens in RDF auto under the tier's WHOLE served switch
 * set: the example (P1, modelled, moving on by itself) and the child's try (P2: the sound, a wrong tap's feedback, the
 * retry, the right card shown; and the right tap) on a 360×640 phone (dpr 2 and 3) and an 800×1280 tablet, Urdu and
 * English, on the set sandbox serves today and on the staging set (the same plus the round-28 cue guard and toggle fit).
 *
 * Why this file: every earlier practice fit row was coach-led. In RDF auto the practice screen's body ran 11 px (Urdu)
 * / 17 px (English) past its box on a 360×640 phone, toggle drawn or not, which the item screen never did. A screen
 * that scrolls by a few pixels draws nothing wrong yet, but it is the margin the round-9 cue and a shorter phone eat
 * first. The bar is the item screen's: nothing scrolls, five cards whole and hit at their centre, the replay and the
 * practice Next in reach, no cue, nothing of the child's under the coach page's corner hold.
 *
 * A real browser lays the screen out (jsdom has none): skipped, never red, where there is no playwright-core
 * (PWCORE=<path>) or no chromium. Fixtures are the committed coach batteries; no network.
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
const SETS = [{ name: 'demo', ui: SERVED_UI }, { name: 'staging', ui: Object.assign({}, SERVED_UI, { r28_cue_guard: true, r28_toggle_fit: true }) }];
const ON = { rdfW3Forms: true, r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true, oneAtATime: true };
const FRAMES = [
  { name: 'phone2', vp: { width: 360, height: 640 }, dpr: 2 },
  { name: 'phone3', vp: { width: 360, height: 640 }, dpr: 3 },
  { name: 'tablet', vp: { width: 800, height: 1280 }, dpr: 1.5 },
];

/** The coach battery of `lang` (grade 2, Set A) as the route serves it, with the set's `ui`; the picker with its practice. */
function served(lang, ui) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${lang}.json`), 'utf8'));
  const b = applySwitches(raw, ON);
  const t = b.tasks.find((x) => x.id === `${lang}.letter_pick10`);
  const bat = Object.assign({}, b, { ui: Object.assign({}, ui), tasks: [t] });
  delete bat.rdf_auto; delete bat.rdf_manual;
  return bat;
}
function other(lang, ui) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const o = lang === 'ur' ? 'en' : 'ur';
  const b = applySwitches(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${o}.json`), 'utf8')), ON);
  return Object.assign({}, b, { ui: Object.assign({}, ui) });
}

function html(lang, ui) {
  const bat = served(lang, ui);
  const hold = [lang === 'ur' ? 'جائزہ ختم (کوچ)' : 'End test (coach)']; // RDF auto: the coach page's End test alone
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
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: false, one_at_a_time: true });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: false, handover: false, ur_fit: true,
    r28: { letter_pick: true, mcq: true, ceiling: true }, speak: speak, embed: true });
  runner.start(); runner.instructionDone(); view.render();
  view.setSync({ state: 'synced' });
  view.langBattery('${lang === 'ur' ? 'en' : 'ur'}', SAE.core.normalize(${JSON.stringify(other(lang, ui))}), {});
  (function () {
    var hb = document.createElement('div'); hb.id = 'hold'; hb.setAttribute('dir', '${lang === 'ur' ? 'rtl' : 'ltr'}');
    hb.style.cssText = 'position:fixed;top:8px;inset-inline-start:8px;display:flex;gap:8px;z-index:1001;font:600 12px/16px system-ui,sans-serif';
    ${JSON.stringify(hold)}.forEach(function (t) { var b = document.createElement('button'); b.textContent = t; b.style.cssText = 'min-height:48px;min-width:48px;padding:4px 12px;border:1px solid #cbd5e1;border-radius:12px;background:rgba(255,255,255,.9);font:inherit'; hb.appendChild(b); });
    document.body.appendChild(hb);
  }());
  window.__view = view; window.__runner = runner;
</script></body></html>`;
}

/** In the page: the cards, the replay pill and the practice Next hit at their centres inside the viewport; every scroll box's overflow. */
const measure = () => document.fonts.ready.then(() => {
  const vh = window.innerHeight;
  const R = (e) => { const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const hits = (k) => { const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!e && (e === k || k.contains(e)); };
  const whole = (k) => { const b = k.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh && b.left >= 0 && b.right <= window.innerWidth; };
  const over = (n) => (n ? Math.max(0, +(n.scrollHeight - n.clientHeight).toFixed(1)) : 0);
  const scr = document.querySelector('.sae-screen');
  const body = scr && scr.querySelector('.sae-body');
  const head = document.querySelector('.sae-pick-head');
  const cueEl = Array.from(document.querySelectorAll('.sae-r9-scroll')).find((c) => !c.hidden && getComputedStyle(c).display !== 'none');
  const hb = document.getElementById('hold'); const a = hb && hb.getBoundingClientRect();
  const meets = (k) => { const b = k.getBoundingClientRect(); return !!a && b.width > 0 && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; };
  const box = (k) => (k ? Object.assign(R(k), { whole: whole(k), hit: hits(k) }) : null);
  const v = window.__runner.view();
  const fb = document.querySelector('.sae-pick .sae-fb:not(.is-empty)');
  // the overflow with the cue hidden (the cue is drawn because the box overflowed, and then takes room of its own), and
  // every element of the body that reaches past the body's own box then (what the overflow is made of)
  const cueAll = Array.from(document.querySelectorAll('.sae-r9-scroll')); const was = cueAll.map((c) => c.hidden); cueAll.forEach((c) => { c.hidden = true; });
  const trueOver = { body: over(body), screen: over(scr) };
  const bb = body ? body.getBoundingClientRect() : null;
  const past = body ? Array.from(body.querySelectorAll('*')).filter((n) => { const b = n.getBoundingClientRect(); return b.height > 0 && b.bottom > bb.bottom - parseFloat(getComputedStyle(body).paddingBottom) + 0.5; }).slice(0, 12).map((n) => ({ cls: String(n.className).split(' ').slice(0, 2).join('.'), top: +n.getBoundingClientRect().top.toFixed(1), bottom: +n.getBoundingClientRect().bottom.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1), mb: getComputedStyle(n).marginBottom, pb: getComputedStyle(n).paddingBottom })) : [];
  // the cards grid's own scroll box: the modelled card's hand (absolute, below the card) shows here as sh > ch
  const grid = body && body.querySelector('.sae-opts') ? (() => { const g = body.querySelector('.sae-opts'); return { h: +g.getBoundingClientRect().height.toFixed(1), sh: g.scrollHeight, ch: g.clientHeight, model: Array.from(g.children).filter((k) => k.classList.contains('is-model')).map((k) => ({ sh: k.scrollHeight, ch: k.clientHeight })) }; })() : null;
  cueAll.forEach((c, i) => { c.hidden = was[i]; });
  return {
    true_over: trueOver, past, grid, body_box: bb ? { top: +bb.top.toFixed(1), bottom: +bb.bottom.toFixed(1) } : null,
    vh, phase: v.phase, practice: v.practice ? v.practice.id : null, screen_cls: scr ? String(scr.className) : null,
    pad_top: scr ? parseFloat(getComputedStyle(scr).paddingTop) : null,
    body_mode: body ? getComputedStyle(body).overflowY : null, body_over: over(body), screen_over: over(scr), inner: over(scr) + over(body),
    page_over: Math.max(0, document.documentElement.scrollHeight - vh),
    cards: Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt')).map((k) => Object.assign(box(k), { shown: k.classList.contains('is-shown') })),
    pill: box(document.querySelector('.sae-pick-replay')), next: box(document.querySelector('.sae-pick-next')),
    fb: fb ? Object.assign(R(fb), { text: fb.textContent.trim(), whole: fb.scrollWidth <= fb.clientWidth + 0.5 && fb.scrollHeight <= fb.clientHeight + 0.5 }) : null,
    cue: cueEl ? R(cueEl) : null, toggle: !!document.querySelector('.sae-screen .sae-r8-lang'), fold: !!document.querySelector('details.sae-pick-coach'),
    hold_hits: Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt, .sae-pick-replay, .sae-pick-next')).filter(meets).map((k) => String(k.className).split(' ')[0]),
    // the screen's blocks top to bottom (where the height goes)
    layout: scr ? [scr].concat(Array.from(scr.children), body ? Array.from(body.children) : [], head ? Array.from(head.children) : []).map((n) => ({ cls: String(n.className).split(' ').slice(0, 2).join('.') || n.tagName.toLowerCase(), top: +n.getBoundingClientRect().top.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1) })) : null,
    boxes: scr ? { screen: { sh: scr.scrollHeight, ch: scr.clientHeight, pb: parseFloat(getComputedStyle(scr).paddingBottom), gap: parseFloat(getComputedStyle(scr).rowGap) }, body: body ? { sh: body.scrollHeight, ch: body.clientHeight, pt: parseFloat(getComputedStyle(body).paddingTop), pb: parseFloat(getComputedStyle(body).paddingBottom), gap: parseFloat(getComputedStyle(body).rowGap) } : null } : null,
  };
});

maybe('the letter picker\'s practice in RDF auto under the served switch set: the example and the child\'s try fit a 360×640 phone whole, nothing scrolls', () => {
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  async function walk(lang, fr, set, right) {
    const ctx = await browser.newContext({ viewport: fr.vp, deviceScaleFactor: fr.dpr });
    const p = await ctx.newPage();
    const doc = html(lang, set.ui);
    await p.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
      if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
      if (u.pathname === '/') return route.fulfill({ body: doc, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: '' });
    });
    await p.goto('http://sa.test/');
    const tag = `${set.name}_${lang}_${fr.name}${right ? '_right' : ''}`;
    const rows = [];
    if (!right) rows.push(Object.assign({ state: 'load' }, await p.evaluate(measure)));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    const snap = async (name, wait) => {
      if (wait !== 0) await p.waitForTimeout(wait || 250);
      rows.push(Object.assign({ state: name }, await p.evaluate(measure)));
      if (process.env.SA_PRAC_SHOT_DIR) await p.screenshot({ path: path.join(process.env.SA_PRAC_SHOT_DIR, `prac_${name}_${tag}.png`) });
    };
    const endAll = async () => { for (let k = 0; k < 8 && (await p.evaluate(() => window.__end())); k++) await p.waitForTimeout(150); };
    const practice = () => p.evaluate(() => { const v = window.__runner.view(); return v.practice ? v.practice.id : v.phase; });
    const card = async (k) => { const c = await p.evaluate((k) => { const b = document.querySelectorAll('.sae-pick-cards .sae-opt')[k].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, k); await p.mouse.click(c.x, c.y); };
    const wrong = () => p.evaluate(() => { const v = window.__runner.view(); return v.practice.options.findIndex((o) => String(o) !== String(v.practice.target)); });
    const rightIdx = () => p.evaluate(() => { const v = window.__runner.view(); return v.practice.options.findIndex((o) => String(o) === String(v.practice.target)); });
    if (!right) await snap('p1_listening', 0);
    // P1: the model line plays, then the example is modelled (its Next pill drawn); RDF auto moves on by itself 2 s later
    for (let k = 0; k < 12 && !(await p.evaluate(() => !!document.querySelector('.sae-pick-next'))) && /\.p1$/.test(await practice()); k++) { await endAll(); await p.waitForTimeout(300); }
    if (!right && /\.p1$/.test(await practice())) await snap('model');
    for (let k = 0; k < 40 && /\.p1$/.test(await practice()); k++) { await endAll(); await p.waitForTimeout(250); }
    await snap('p2_listening', 0);
    await endAll();
    await snap('p2_aftersound');
    if (right) {
      await card(await wrong()); await p.waitForTimeout(1600); await endAll(); await p.waitForTimeout(250);
      await card(await rightIdx());
      await snap('p2_feedback_right', 0); // the right tap: the picker held with its feedback (the 1.2 s floor under the line)
      await endAll(); // Jugnu's line ends; the floor keeps the picker
      await snap('p2_feedback_right_held', 900); // ≈ 1.0 s after the tap: still the picker
      await snap('ready_after_right', 500); // ≈ 1.5 s: the Ready screen
      await ctx.close();
      if (process.env.SA_PRAC_LOG) fs.appendFileSync(process.env.SA_PRAC_LOG, JSON.stringify({ lang, frame: fr.name, set: set.name, walk: 'right', rows }) + '\n');
      return rows;
    }
    await card(await wrong());
    await snap('p2_feedback', 150); // the feedback line (try again), inside FEEDBACK_MS
    await p.waitForTimeout(1600);
    await endAll();
    await snap('p2_retry');
    await card(await wrong());
    await snap('p2_feedback_shown', 0); // the second wrong tap: the right card shown, the picker held (the 1.2 s floor)
    await endAll(); // Jugnu's line ends; the floor keeps the picker
    await snap('p2_feedback_shown_held', 900); // ≈ 1.0 s after the tap: still the picker, the right card shown
    await snap('ready_after_shown', 500); // ≈ 1.5 s: the Ready screen
    await ctx.close();
    if (process.env.SA_PRAC_LOG) fs.appendFileSync(process.env.SA_PRAC_LOG, JSON.stringify({ lang, frame: fr.name, set: set.name, walk: 'wrong', rows }) + '\n');
    return rows;
  }
  /** The bar, one row per state: nothing scrolls, five cards whole and hit, the replay pill and the practice Next (when
   *  drawn) hit with their feet 8 px clear of the edge, the feedback line whole, no cue, no fold (RDF auto), nothing of
   *  the child's under the coach page's corner hold. */
  const bar = (r) => ({
    state: r.state, phase: r.phase, inner: r.inner, true_over: r.true_over.body + r.true_over.screen, page_over: r.page_over, cards: r.cards.length, cards_whole: r.cards.filter((c) => c.whole).length, cards_hit: r.cards.filter((c) => c.hit).length,
    shown: r.cards.filter((c) => c.shown).length, pill: r.pill ? { hit: r.pill.hit, foot_ok: r.pill.bottom <= r.vh - 8 } : null, next: r.next ? { hit: r.next.hit, foot_ok: r.next.bottom <= r.vh - 8 } : null,
    fb: r.fb ? r.fb.whole : null, cue: !!r.cue, fold: r.fold, hold_hits: r.hold_hits,
  });
  // every practice state holds its five cards, the last feedback (the right card shown, or the right tap's feedback)
  // included for its 1.2 s floor; only the Ready screen read after that floor (the `ready_after_*` states) holds none
  const isReady = (r) => /^ready_after_/.test(r.state);
  const want = (r) => ({
    state: r.state, phase: /^(p2_feedback_(shown|right)(_held)?|ready_after_.*)$/.test(r.state) ? 'ready' : r.phase, inner: 0, true_over: 0, page_over: 0,
    cards: isReady(r) ? 0 : 5, cards_whole: isReady(r) ? 0 : 5, cards_hit: isReady(r) ? 0 : 5,
    shown: /^p2_feedback_shown(_held)?$/.test(r.state) ? 1 : 0, pill: r.pill ? { hit: true, foot_ok: true } : null, next: r.next ? { hit: true, foot_ok: true } : null,
    fb: r.fb ? true : null, cue: false, fold: false, hold_hits: [],
  });
  const P2 = ['p2_listening', 'p2_aftersound', 'p2_feedback', 'p2_retry', 'p2_feedback_shown'];

  for (const set of SETS) for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`[${set.name}] ${lang} ${fr.name} (${fr.vp.width}×${fr.vp.height} dpr ${fr.dpr}): P1 listening and modelled, P2 the sound, the feedback, the retry, the right card shown, the right tap — nothing scrolls, five cards and the replay in reach`, async () => {
      const rows = await walk(lang, fr, set, false);
      rows.push(...(await walk(lang, fr, set, true)));
      // the walk reached every state it names
      expect(rows.map((r) => ({ state: r.state, practice: r.practice || r.phase }))).toEqual(
        [{ state: 'load', practice: `${lang}.letter_pick10.p1` }, { state: 'p1_listening', practice: `${lang}.letter_pick10.p1` }, { state: 'model', practice: `${lang}.letter_pick10.p1` }]
          .concat(P2.map((s) => ({ state: s, practice: s === 'p2_feedback_shown' ? 'ready' : `${lang}.letter_pick10.p2` })))
          .concat([{ state: 'p2_feedback_shown_held', practice: 'ready' }, { state: 'ready_after_shown', practice: 'ready' }])
          .concat([{ state: 'p2_listening', practice: `${lang}.letter_pick10.p2` }, { state: 'p2_aftersound', practice: `${lang}.letter_pick10.p2` }, { state: 'p2_feedback_right', practice: 'ready' }, { state: 'p2_feedback_right_held', practice: 'ready' }, { state: 'ready_after_right', practice: 'ready' }]));
      expect(rows.map(bar)).toEqual(rows.map(want));
      // the example is modelled on both P1 states (a card carries the hand), so the cards block's room for it is what is measured
      expect(rows.filter((r) => /^(p1_listening|model)$/.test(r.state)).map((r) => ({ state: r.state, modelled: !!r.grid && r.grid.model.length }))).toEqual([{ state: 'p1_listening', modelled: 1 }, { state: 'model', modelled: 1 }]);
    }, 240000);
  }
});
