'use strict';
/**
 * Round 28 (sa_r28_mcq), the spoken story questions' PRACTICE in RDF AUTO on a 360×640 phone under the tier's whole
 * served switch set: the practice question fits like the scored one. In every practice frame (the question and its
 * options read out, open, the child's answer, its feedback) the four option cards are whole and hit-testable at their
 * centre, no scroll box overflows and no scroll cue is drawn, and the cards keep >= 8 px between them (practice and
 * scored, Urdu and English). The scored question is the control: it fits today and must not move.
 *
 * Why this file: a child alone with the phone learns on the practice question to listen to every card and tap one. In
 * Urdu the practice's head row (Jugnu, the practice chip, the replay) drew taller than the scored one, so the fourth
 * card sat under the fold with the scroll cue over it: a practice where the right answer could be a card the child
 * never saw.
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
/** The same task with its practice kept (coach-led: the practice's passage step draws the coach box and the coach line). */
function batteryWithPractice(lang, ui) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${lang}.json`), 'utf8'));
  const b = applySwitches(raw, ON);
  const t = b.tasks.find((x) => x.id === `${lang}.story_mcq_w3`);
  const bat = Object.assign({}, b, { ui: Object.assign({}, ui), tasks: [Object.assign({}, t, { depends_on: null })] });
  delete bat.rdf_auto; delete bat.rdf_manual;
  return bat;
}
function other(lang, ui) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const o = lang === 'ur' ? 'en' : 'ur';
  const b = applySwitches(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${o}.json`), 'utf8')), ON);
  return Object.assign({}, b, { ui: Object.assign({}, ui) });
}

function html(lang, ui, coach, practice) {
  const bat = coach || practice ? batteryWithPractice(lang, ui) : battery(lang, ui);
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
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: ${!!coach}, one_at_a_time: true${process.env.SA_MCQ_DEVJUMP ? ', dev_tools: true' : ''} });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${!!coach}, handover: false, ur_fit: true,
    r28: { letter_pick: true, mcq: true, ceiling: true }, speak: speak, embed: true${process.env.SA_MCQ_DEVJUMP ? ', devJump: function () {}' : ''} });
  runner.start(); runner.instructionDone(); ${coach ? '' : 'runner.begin(); '}view.render();
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
    card_gap: (() => { const o = Array.from(document.querySelectorAll('.sae-mcq-opts .sae-mcq-opt')).map((k) => k.getBoundingClientRect()); return o.length > 1 ? +Math.min(...o.slice(1).map((b, i) => b.top - o[i].bottom)).toFixed(1) : null; })(),
    practice: !!(scr && /sae-mcq-practice/.test(scr.className)), passage_step: !!(scr && /sae-mcq-passage-step/.test(scr.className)),
    head: (() => { const hd = document.querySelector('.sae-mcq-head'); return hd ? Object.assign(R(hd), { kids: Array.from(hd.children).map((k) => String(k.className).split(' ')[0] + ':' + Math.round(k.getBoundingClientRect().height)) }) : null; })(),
    q: box(document.querySelector('.sae-mcq-q')), replay: box(document.querySelector('.sae-screen .sae-replay, .sae-screen .sae-mcq-replay')),
    next: (() => { const k = document.querySelector('.sae-screen .sa-next'); return k ? Object.assign(box(k), { text: k.textContent.trim(), cp: Array.from(k.textContent.trim()).length, in_head: !!k.closest('.sae-mcq-head'), clipped: k.scrollWidth > k.clientWidth + 0.5, sw: k.scrollWidth, cw: k.clientWidth, sh: k.scrollHeight, ch: k.clientHeight }) : null; })(),
    next_targets: document.querySelectorAll('.sae-screen .sa-next, .sae-screen button.sae-mcq-next').length,
    toggle_rect: (() => { const t = document.querySelector('.sae-screen .sae-r8-lang'); return t ? R(t) : null; })(),
    jugnu: (() => { const j = document.querySelector('.sae-mcq-head .sae-jugnu'); return j ? R(j) : null; })(),
    cue: cue ? R(cue) : null, toggle: !!document.querySelector('.sae-screen .sae-r8-lang'),
    hold_hits: Array.from(document.querySelectorAll('.sae-mcq-opts .sae-mcq-opt, .sae-screen .sae-replay, .sae-screen .sa-next')).filter(meets).map((k) => String(k.className).split(' ')[0]),
    layout: scr ? [scr].concat(Array.from(scr.children), body ? Array.from(body.children) : []).map((n) => ({ cls: String(n.className).split(' ').slice(0, 2).join('.') || n.tagName.toLowerCase(), top: +n.getBoundingClientRect().top.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1) })) : null,
    foot: (() => { const f = scr && scr.querySelector(':scope > .sae-foot'); return f ? Object.assign(R(f), { pos: getComputedStyle(f).position, kids: Array.from(f.children).map((k) => String(k.className).split(' ')[0] + ':' + Math.round(k.getBoundingClientRect().height)) }) : null; })(),
  };
});


maybe('the spoken story questions\' practice in RDF auto on a 360×640 phone fits like the scored question: four cards whole, nothing scrolls, the cards apart', () => {
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  async function walk(lang, fr, set) {
    const ctx = await browser.newContext({ viewport: fr.vp, deviceScaleFactor: fr.dpr });
    const p = await ctx.newPage();
    const doc = html(lang, set.ui, false, true);
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
      if (process.env.SA_MCQ_SHOT_DIR) await p.screenshot({ path: path.join(process.env.SA_MCQ_SHOT_DIR, `mcqp_${name}_${tag}.png`) });
    };
    const reading = () => p.evaluate(() => !!document.querySelector('.sae-mcq-jugnu.is-talking') || !!document.querySelector('.sae-screen.sae-mcq-listening') || !!document.querySelector('.sae-screen.sae-mcq-passage-step'));
    const readOut = async () => { for (let k = 0; k < 60 && (await reading()); k++) { await p.evaluate(() => window.__end()); await p.waitForTimeout(150); } await p.waitForTimeout(400); };
    const isPractice = () => p.evaluate(() => !!document.querySelector('.sae-screen.sae-mcq-practice'));
    // the practice's passage step (its clip; measured for the report, not a card screen), then the practice question
    const passage = await p.evaluate(measure);
    if (process.env.SA_MCQ_SHOT_DIR) await p.screenshot({ path: path.join(process.env.SA_MCQ_SHOT_DIR, `mcqp_passage_${tag}.png`) });
    for (let k = 0; k < 20 && !(await p.evaluate(() => !!document.querySelector('.sae-screen.sae-mcq-practice:not(.sae-mcq-passage-step) .sae-mcq-opt'))); k++) { await p.evaluate(() => window.__end()); await p.waitForTimeout(200); }
    await snap('p_early', 0); // the practice question and its options being read out
    await readOut();
    await snap('p_read'); // every option read, waiting for the tap
    const tgt = await p.evaluate(() => { const v = window.__runner.view(); return v.practice ? v.practice.target_index : null; });
    await p.evaluate((i) => { const b = document.querySelectorAll('.sae-mcq-opts .sae-mcq-opt')[i]; if (b) b.click(); }, tgt == null ? 0 : (tgt + 1) % 4); // a wrong card first
    await snap('p_tried', 150);
    await readOut();
    await snap('p_feedback', 1400); // past the chosen card's press: the feedback names the right card
    // on to the scored question (the control): end every line until the practice has given way
    for (let k = 0; k < 40 && (await isPractice()); k++) {
      await p.evaluate((i) => { const b = document.querySelector('.sae-mcq-opts .sae-mcq-opt[data-index="' + i + '"]:not([disabled])'); if (b) b.click(); window.__end(); window.__T += 2000; window.__view.render(); }, tgt == null ? 1 : tgt);
      await p.waitForTimeout(250);
    }
    for (let k = 0; k < 10 && !(await p.evaluate(() => !!document.querySelector('.sae-screen.sae-mcq:not(.sae-mcq-practice) .sae-mcq-opt'))); k++) {
      await p.evaluate(() => { const b = document.querySelector('.sae-screen .sae-go, .sae-screen .sa-start, .sae-screen button.sae-primary'); if (b) b.click(); window.__end(); window.__view.render(); });
      await p.waitForTimeout(250);
    }
    await readOut();
    await snap('q1_read');
    await ctx.close();
    if (process.env.SA_MCQ_LOG) fs.appendFileSync(process.env.SA_MCQ_LOG, JSON.stringify({ lang, frame: fr.name, set: set.name, passage, rows }) + '\n');
    return rows;
  }
  const bar = (r) => ({ state: r.state, practice: r.practice, opts: r.opts.length, opts_whole: r.opts.filter((o) => o.whole).length, opts_hit: r.opts.filter((o) => o.hit).length,
    body_over: r.body_over, screen_over: r.screen_over, page_over: r.page_over, true_over: r.true_over.body + r.true_over.screen, cue: !!r.cue, gap_ok: r.card_gap >= 8 });
  const want = (r) => ({ state: r.state, practice: r.state !== 'q1_read', opts: 4, opts_whole: 4, opts_hit: 4, body_over: 0, screen_over: 0, page_over: 0, true_over: 0, cue: false, gap_ok: true });

  for (const set of SETS) for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`[${set.name}] ${lang} ${fr.name} (${fr.vp.width}×${fr.vp.height} dpr ${fr.dpr}): the practice question read, open, tried, its feedback, and the scored question: four cards whole and apart, nothing scrolls`, async () => {
      const rows = await walk(lang, fr, set);
      expect(rows.map(bar)).toEqual(rows.map(want));
      // the cards keep their size: >= 56 px tall (48 px targets and more)
      expect(rows.map((r) => r.opts.every((o) => o.h >= 56))).toEqual(rows.map(() => true));
    }, 180000);
  }
});
