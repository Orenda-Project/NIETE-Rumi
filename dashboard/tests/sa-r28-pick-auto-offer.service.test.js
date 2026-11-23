'use strict';
/**
 * Round 28 (sa_r28_letter_pick), the letter picker's scored items in RDF AUTO on a 360×640 phone under the tier's
 * WHOLE served switch set, at the state the earlier rows left out: Next OFFERED (30 s with no answer) on items 1–3,
 * and the chosen state after it. The bar is the item screen's: five cards whole and hit at their centre, the replay
 * hit with its foot 8 px clear of the edge, Next hit, no scroll box overflowing, no cue; and nothing moves when Next
 * is offered (the cards and the replay keep their boxes). Both served sets, Urdu and English, dpr 3 and 2; the tablet
 * as the control.
 *
 * Why this file: Next at the foot in Urdu is a 95 px button, and with the cue it drew the foot took 180 px — two of
 * five cards reachable and the replay under the fold on every item from the first, for a child alone.
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

function served(lang, ui) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${lang}.json`), 'utf8'));
  const b = applySwitches(raw, ON);
  const t = b.tasks.find((x) => x.id === `${lang}.letter_pick10`);
  const bat = Object.assign({}, b, { ui: Object.assign({}, ui), tasks: [Object.assign({}, t, { practice: [] })] });
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
  const hold = [lang === 'ur' ? 'جائزہ ختم (کوچ)' : 'End test (coach)'];
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
    vh, phase: v.phase, ii: v.item_index, pad_top: scr ? parseFloat(getComputedStyle(scr).paddingTop) : null,
    body_over: over(body), screen_over: over(scr), page_over: Math.max(0, document.documentElement.scrollHeight - vh), true_over: trueOver,
    cards: Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt')).map(box),
    head: (() => { const hd = document.querySelector('.sae-pick-head'); return hd ? Object.assign(R(hd), { kids: Array.from(hd.children).map((k) => ({ cls: String(k.className).split(' ')[0], w: +k.getBoundingClientRect().width.toFixed(1), h: +k.getBoundingClientRect().height.toFixed(1), vis: getComputedStyle(k).visibility })) }) : null; })(),
    pill: box(document.querySelector('.sae-pick-replay')),
    next: (() => { const k = document.querySelector('.sae-screen .sa-next'); return k ? Object.assign(box(k), { text: k.textContent.trim(), cp: Array.from(k.textContent.trim()).length, in_head: !!k.closest('.sae-pick-head'), clipped: k.scrollWidth > k.clientWidth + 0.5, sw: k.scrollWidth, cw: k.clientWidth, sh: k.scrollHeight, ch: k.clientHeight }) : null; })(),
    fold: (() => { const d = document.querySelector('details.sae-pick-coach'); return d ? R(d) : null; })(),
    jugnu: (() => { const j = document.querySelector('.sae-pick-head .sae-jugnu'); return j ? R(j) : null; })(),
    next_targets: document.querySelectorAll('.sae-screen .sa-next').length, head_replay: !!document.querySelector('.sae-pick-head .sae-replay'), cue: cue ? R(cue) : null,
    hold_hits: Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt, .sae-pick-replay, .sae-screen .sa-next')).filter(meets).map((k) => String(k.className).split(' ')[0]),
    layout: scr ? [scr].concat(Array.from(scr.children), body ? Array.from(body.children) : []).map((n) => ({ cls: String(n.className).split(' ').slice(0, 2).join('.') || n.tagName.toLowerCase(), top: +n.getBoundingClientRect().top.toFixed(1), h: +n.getBoundingClientRect().height.toFixed(1) })) : null,
    foot: (() => { const f = scr && scr.querySelector(':scope > .sae-foot'); return f ? Object.assign(R(f), { kids: Array.from(f.children).map((k) => String(k.className).split(' ')[0] + ':' + Math.round(k.getBoundingClientRect().height)) }) : null; })(),
  };
});

maybe('the letter picker in RDF auto on a 360×640 phone under the served switch set: Next offered on items 1–3, five cards, the replay and Next in reach, nothing moves', () => {
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
      if (process.env.SA_OFFER_SHOT_DIR) await p.screenshot({ path: path.join(process.env.SA_OFFER_SHOT_DIR, `offer_${name}_${tag}.png`) });
    };
    const endAll = async () => { for (let k = 0; k < 8 && (await p.evaluate(() => window.__end())); k++) await p.waitForTimeout(150); };
    for (let k = 0; k < 3; k++) {
      await endAll();
      await snap(`item${k + 1}_read`);
      for (let j = 0; j < 8; j++) { // RDF auto: Next at 30 s with no answer; the auto replay at 10 s restarts the clock at its end
        await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
        await p.waitForTimeout(250);
        await endAll();
        if (await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sae-screen .sa-next'); })) break;
      }
      await snap(`item${k + 1}_offernext`);
      // the child's tap on card 3 (at its centre, as a finger): the pressed card, before the next item is drawn
      await p.evaluate(() => { const b = document.querySelectorAll('.sae-pick-cards .sae-opt')[2]; const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); });
      await snap(`item${k + 1}_chosen`, 60);
      await p.waitForTimeout(600);
    }
    await ctx.close();
    if (process.env.SA_OFFER_LOG) fs.appendFileSync(process.env.SA_OFFER_LOG, JSON.stringify({ lang, frame: fr.name, set: set.name, rows }) + '\n');
    return rows;
  }
  const bar = (r) => ({ state: r.state, cards: r.cards.length, cards_whole: r.cards.filter((c) => c.whole).length, cards_hit: r.cards.filter((c) => c.hit).length,
    pill: r.pill ? { hit: r.pill.hit, foot_ok: r.pill.bottom <= r.vh - 8 } : null, next: r.next ? { whole: r.next.whole, hit: r.next.hit } : null,
    body_over: r.body_over, screen_over: r.screen_over, page_over: r.page_over, true_over: r.true_over.body + r.true_over.screen, cue: !!r.cue, hold_hits: r.hold_hits });
  // Next is drawn at offer-next (and may still stand on the chosen state, until the next item draws): whole and hit whenever drawn
  const want = (r) => ({ state: r.state, cards: 5, cards_whole: 5, cards_hit: 5, pill: { hit: true, foot_ok: true }, next: /offernext$/.test(r.state) || r.next ? { whole: true, hit: true } : null,
    body_over: 0, screen_over: 0, page_over: 0, true_over: 0, cue: false, hold_hits: [] });

  for (const set of SETS) for (const fr of FRAMES) for (const lang of ['ur', 'en']) {
    test(`[${set.name}] ${lang} ${fr.name} (${fr.vp.width}×${fr.vp.height} dpr ${fr.dpr}): items 1–3 read, Next offered, chosen — five cards, the replay and Next in reach, nothing scrolls, nothing moves`, async () => {
      const rows = await walk(lang, fr, set);
      expect(rows.filter((r) => /offernext$/.test(r.state) && r.next).length).toBe(3);
      expect(rows.map(bar)).toEqual(rows.map(want));
      // the offered pill: in the head row, ≥ 56 tall and ≥ 48 wide, ≥ 16 px from the replay pill's hit rect, the word with its arrow (≤ 20 code points); before the offer no Next target, and no second replay in the head
      const gap = (a, b) => Math.max(0, a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);
      const offered = rows.filter((r) => /offernext$/.test(r.state));
      expect(offered.map((r) => ({ in_head: r.next.in_head, tall: r.next.h >= 56, wide: r.next.w >= 48, gap_ok: gap(r.next, r.pill) >= 16, text: r.next.text, cp_ok: r.next.cp <= 20, clipped: r.next.clipped })))
        .toEqual(offered.map(() => ({ in_head: true, tall: true, wide: true, gap_ok: true, text: lang === 'ur' ? 'آگے ←' : 'Next →', cp_ok: true, clipped: false })));
      // the offered pill shares no pixel with a card, the fold (none in RDF auto) or Jugnu
      const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
      expect(offered.map((r) => ({ over_cards: r.cards.filter((c) => overlap(r.next, c)).length, over_fold: !!r.fold && overlap(r.next, r.fold), over_jugnu: !!r.jugnu && overlap(r.next, r.jugnu) })))
        .toEqual(offered.map(() => ({ over_cards: 0, over_fold: false, over_jugnu: false })));
      expect(rows.filter((r) => /_read$/.test(r.state)).map((r) => ({ state: r.state, targets: r.next_targets, head_replay: r.head_replay }))).toEqual(rows.filter((r) => /_read$/.test(r.state)).map((r) => ({ state: r.state, targets: 0, head_replay: false })));
      // nothing moves when Next is offered: the cards and the replay keep their boxes from the read state
      const at = (r) => ({ cards: r.cards.map((c) => [c.top, c.left, c.w, c.h].join()), pill: r.pill && [r.pill.top, r.pill.left].join() });
      for (let k = 1; k <= 3; k++) expect({ k, moved: at(rows.find((r) => r.state === `item${k}_offernext`)) }).toEqual({ k, moved: at(rows.find((r) => r.state === `item${k}_read`)) });
    }, 240000);
  }
});
