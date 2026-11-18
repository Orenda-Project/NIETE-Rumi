'use strict';
/**
 * Round 28 (sa_r28_mcq), the spoken story questions in RDF AUTO on a 360×640 phone under the tier's WHOLE served
 * switch set: on every question, early (while the question and its options are read out), with Next offered (no
 * answer), and on the second question, all four option cards are whole and hit-testable at their centre, the replay
 * is in view, no scroll box overflows and no scroll cue is drawn. Both served sets (today's, and the staging set with
 * the cue guard and toggle fit on), Urdu and English, dpr 3 and 2, and the tablet as the control.
 *
 * Why this file: a child alone on a 360-px phone saw two and a half of four options while the fourth lit up off-screen
 * (an unreachable right option is a forced wrong with four choices). Every earlier MCQ fit row was coach-led.
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
  { name: 'phone3', vp: { width: 360, height: 640 }, dpr: 3 },
  { name: 'phone2', vp: { width: 360, height: 640 }, dpr: 2 },
  { name: 'tablet', vp: { width: 800, height: 1280 }, dpr: 1.5 },
];

/** The coach battery's story questions (grade 2, Set A) as the route serves them, alone, with the set's `ui`. */
function battery(lang, ui) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${lang}.json`), 'utf8'));
  const b = applySwitches(raw, ON);
  const t = b.tasks.find((x) => x.id === `${lang}.story_mcq_w3`);
  const bat = Object.assign({}, b, { ui: Object.assign({}, ui), tasks: [Object.assign({}, t, { practice: [], depends_on: null })] });
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
  const bat = battery(lang, ui);
  const hold = [lang === 'ur' ? 'جائزہ ختم (کوچ)' : 'End test (coach)']; // RDF auto: the coach page's End test alone
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__T = 0;
  var cur = null;
  // every read-out (the question, each option) ends only when the test says (window.__end()), like a clip on a device
  function speak(text, audio, vo) {
    var a = new EventTarget(); a.paused = false; a.ended = false; a.currentTime = 0.5; a.duration = 1;
    var line = { a: a }; cur = line;
    return new Promise(function (res) { line.end = function () { a.paused = true; a.ended = true; a.dispatchEvent(new Event('ended')); if (cur === line) cur = null; res(); }; });
  }
  speak.audio = function () { return cur ? cur.a : null; };
  window.__end = function () { if (!cur) return false; cur.end(); return true; };
  var battery = ${JSON.stringify(bat)};
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: false, one_at_a_time: true${process.env.SA_MCQ_DEVJUMP ? ', dev_tools: true' : ''} });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: false, handover: false, ur_fit: true,
    r28: { letter_pick: true, mcq: true, ceiling: true }, speak: speak, embed: true${process.env.SA_MCQ_DEVJUMP ? ', devJump: function () {}' : ''} });
  runner.start(); runner.instructionDone(); runner.begin(); view.render();
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

/** In the page: the four option cards, the replay and Next hit at their centres inside the viewport; every scroll box's overflow. */
const measure = () => document.fonts.ready.then(() => {
  const vh = window.innerHeight;
  const R = (e) => { const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const hits = (k) => { const b = k.getBoundingClientRect(); const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!e && (e === k || k.contains(e)); };
  const whole = (k) => { const b = k.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh && b.left >= 0 && b.right <= window.innerWidth; };
  const over = (n) => (n ? Math.max(0, +(n.scrollHeight - n.clientHeight).toFixed(1)) : 0);
  const box = (k) => (k ? Object.assign(R(k), { whole: whole(k), hit: hits(k) }) : null);
  const scr = document.querySelector('.sae-screen');
  const body = scr && scr.querySelector('.sae-body');
  const cueAll = Array.from(document.querySelectorAll('.sae-r9-scroll'));
  const cue = cueAll.find((c) => !c.hidden && getComputedStyle(c).display !== 'none');
  const was = cueAll.map((c) => c.hidden); cueAll.forEach((c) => { c.hidden = true; });
  const trueOver = { body: over(body), screen: over(scr) };
  cueAll.forEach((c, i) => { c.hidden = was[i]; });
  const hb = document.getElementById('hold'); const a = hb && hb.getBoundingClientRect();
  const meets = (k) => { const b = k.getBoundingClientRect(); return !!a && b.width > 0 && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; };
  const v = window.__runner.view();
  return {
    vh, phase: v.phase, ii: v.item_index, screen_cls: scr ? String(scr.className) : null, pad_top: scr ? parseFloat(getComputedStyle(scr).paddingTop) : null,
    body_mode: body ? getComputedStyle(body).overflowY : null, body_over: over(body), screen_over: over(scr), page_over: Math.max(0, document.documentElement.scrollHeight - vh), true_over: trueOver,
    opts: Array.from(document.querySelectorAll('.sae-mcq-opts .sae-mcq-opt')).map(box),
    q: box(document.querySelector('.sae-mcq-q')), replay: box(document.querySelector('.sae-screen .sae-replay, .sae-screen .sae-mcq-replay')),
    next: (() => { const k = document.querySelector('.sae-screen .sa-next'); return k ? Object.assign(box(k), { text: k.textContent.trim(), cp: Array.from(k.textContent.trim()).length, in_head: !!k.closest('.sae-mcq-head') }) : null; })(),
    next_targets: document.querySelectorAll('.sae-screen .sa-next, .sae-screen button.sae-mcq-next').length,
    cue: cue ? R(cue) : null, toggle: !!document.querySelector('.sae-screen .sae-r8-lang'),
    hold_hits: Array.from(document.querySelectorAll('.sae-mcq-opts .sae-mcq-opt, .sae-screen .sae-replay, .sae-screen .sa-next')).filter(meets).map((k) => String(k.className).split(' ')[0]),
    layout: scr ? [scr].concat(Array.from(scr.children), body ? Array.from(body.children) : []).map((n) => ({ cls: String(n.className).split(' ').slice(0, 2).join('.') || n.tagName.toLowerCase(), top: +n.getBoundingClientRect().top.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1) })) : null,
    foot: (() => { const f = scr && scr.querySelector(':scope > .sae-foot'); return f ? Object.assign(R(f), { pos: getComputedStyle(f).position, kids: Array.from(f.children).map((k) => String(k.className).split(' ')[0] + ':' + Math.round(k.getBoundingClientRect().height)) }) : null; })(),
  };
});

maybe('the spoken story questions in RDF auto on a 360×640 phone under the served switch set: four options, the replay and Next in reach, nothing scrolls', () => {
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  async function walk(lang, fr, set) {
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
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    const tag = `${set.name}_${lang}_${fr.name}`;
    const rows = [];
    const snap = async (name, wait) => {
      if (wait !== 0) await p.waitForTimeout(wait || 250);
      rows.push(Object.assign({ state: name }, await p.evaluate(measure)));
      if (process.env.SA_MCQ_SHOT_DIR) await p.screenshot({ path: path.join(process.env.SA_MCQ_SHOT_DIR, `mcq_${name}_${tag}.png`) });
    };
    // the read-out: the question, then each option in turn (the lit card), with the page's own pauses between them;
    // ended line by line until Jugnu stops talking and the cards are open
    const reading = () => p.evaluate(() => !!document.querySelector('.sae-mcq-jugnu.is-talking') || !!document.querySelector('.sae-screen.sae-mcq-listening'));
    const readOut = async () => { for (let k = 0; k < 60 && (await reading()); k++) { await p.evaluate(() => window.__end()); await p.waitForTimeout(150); } await p.waitForTimeout(400); };
    const offerNext = async () => { // RDF auto: Next offered after the read-out and the wait, with no answer
      for (let j = 0; j < 8; j++) {
        await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
        await p.waitForTimeout(250);
        await readOut();
        if (await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sae-screen .sa-next'); })) break;
      }
    };
    await snap('q1_early', 0); // the question and the options being read out
    await readOut();
    await snap('q1_read'); // every option read, waiting for the tap
    await offerNext();
    await snap('q1_offernext');
    await p.evaluate(() => { window.__runner.answer(0); window.__view.render(); }); // the first option, as the page's tap path answers (by index)
    await p.waitForTimeout(400);
    await snap('q2_early', 0);
    await readOut();
    await snap('q2_read');
    await ctx.close();
    if (process.env.SA_MCQ_LOG) fs.appendFileSync(process.env.SA_MCQ_LOG, JSON.stringify({ lang, frame: fr.name, set: set.name, rows }) + '\n');
    return rows;
  }
  const bar = (r) => ({ state: r.state, ii: r.ii, opts: r.opts.length, opts_whole: r.opts.filter((o) => o.whole).length, opts_hit: r.opts.filter((o) => o.hit).length,
    replay: r.replay ? { whole: r.replay.whole, hit: r.replay.hit } : null, next: r.next ? { whole: r.next.whole, hit: r.next.hit } : null,
    body_over: r.body_over, screen_over: r.screen_over, page_over: r.page_over, true_over: r.true_over.body + r.true_over.screen, cue: !!r.cue, hold_hits: r.hold_hits });
  const want = (r) => ({ state: r.state, ii: /^q2/.test(r.state) ? 1 : 0, opts: 4, opts_whole: 4, opts_hit: 4,
    replay: r.replay ? { whole: true, hit: true } : null, next: r.next ? { whole: true, hit: true } : null,
    body_over: 0, screen_over: 0, page_over: 0, true_over: 0, cue: false, hold_hits: [] });

  for (const set of SETS) for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`[${set.name}] ${lang} ${fr.name} (${fr.vp.width}×${fr.vp.height} dpr ${fr.dpr}): Q1 early, read, Next offered; Q2 early, read — four options, the replay and Next in reach, nothing scrolls`, async () => {
      const rows = await walk(lang, fr, set);
      expect(rows.filter((r) => r.state === 'q1_offernext' && r.next).length).toBe(1);
      expect(rows.map(bar)).toEqual(rows.map(want));
      // the offered pill: in the head row, ≥ 56 tall and ≥ 48 wide, its hit rect ≥ 16 px from the replay's, the word with its arrow (≤ 20 code points); before the offer no Next target exists
      const gap = (a, b) => Math.max(0, a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);
      const offered = rows.filter((r) => r.state === 'q1_offernext');
      expect(offered.map((r) => ({ in_head: r.next.in_head, tall: r.next.h >= 56, wide: r.next.w >= 48, gap_ok: gap(r.next, r.replay) >= 16, text: r.next.text, cp_ok: r.next.cp <= 20 })))
        .toEqual(offered.map(() => ({ in_head: true, tall: true, wide: true, gap_ok: true, text: lang === 'ur' ? 'آگے ←' : 'Next →', cp_ok: true })));
      expect(rows.filter((r) => /^(q1_early|q1_read|q2_early|q2_read)$/.test(r.state)).map((r) => ({ state: r.state, targets: r.next_targets }))).toEqual(['q1_early', 'q1_read', 'q2_early', 'q2_read'].map((s) => ({ state: s, targets: 0 })));
      // nothing moves when Next is offered: the four options and the replay keep their boxes from the read state
      const at = (r) => ({ opts: r.opts.map((o) => [o.top, o.left, o.w, o.h].join()), replay: r.replay && [r.replay.top, r.replay.left].join() });
      const read = rows.find((r) => r.state === 'q1_read'), off = rows.find((r) => r.state === 'q1_offernext');
      expect(at(off)).toEqual(at(read));
    }, 180000);
  }
});
