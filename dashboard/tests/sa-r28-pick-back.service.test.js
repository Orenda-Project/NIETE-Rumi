'use strict';
/**
 * Round 28 (sa_r28_letter_pick), the coach-led picker under the tier's WHOLE served switch set: every scored item screen
 * keeps its five letter cards and its replay pill in reach with no inner scroll, on a 360×640 phone (the coach page's
 * frame: embed, the sync dot, the language toggle, the coach page's two hold buttons; with and without the sandbox-only
 * "Jump to…" row) and on an 800×1280 tablet, Urdu and English.
 *
 * Why this file: every earlier picker fit row mounted a hand-picked subset of the layout switches, and none of them
 * mounted `back_button` (Round 7b), which draws a Back button at the foot of an item screen from the second item on.
 * On a phone that foot row took the room of the second card row and the replay pill. The fixture here is the `ui`
 * block a sandbox page was served, verbatim (fixtures/sa-served-ui.sandbox.json), never a subset.
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

const SA = path.join(__dirname, '..', 'sa');
const PUB = path.join(__dirname, '..', 'public', 'wq');
const SERVED_UI = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sa-served-ui.sandbox.json'), 'utf8'));
// the two switch states the bar is read at: the set sandbox serves today (demo), and the staging set (the same plus the
// round-28 cue guard and toggle fit)
const SETS = [{ name: 'demo', ui: SERVED_UI }, { name: 'staging', ui: Object.assign({}, SERVED_UI, { r28_cue_guard: true, r28_toggle_fit: true }) }];
const ON = { rdfW3Forms: true, r28LetterPick: true, r28Mcq: true, r28Ceiling: true, r28StoryClock: true, oneAtATime: true };

/** The coach battery of `lang` (grade 2, Set A) as the route serves it, with the tier's served `ui`; the picker alone. */
function served(lang, ui, keepPractice) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${lang}.json`), 'utf8'));
  const b = applySwitches(raw, ON);
  const t = b.tasks.find((x) => x.id === `${lang}.letter_pick10`);
  const bat = Object.assign({}, b, { ui: Object.assign({}, ui), tasks: [keepPractice ? t : Object.assign({}, t, { practice: [] })] });
  delete bat.rdf_auto; delete bat.rdf_manual;
  return bat;
}
function other(lang, ui) {
  const { applySwitches } = require('../routes/sa-battery-switches');
  const o = lang === 'ur' ? 'en' : 'ur';
  const b = applySwitches(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${o}.json`), 'utf8')), ON);
  return Object.assign({}, b, { ui: Object.assign({}, ui) });
}

function html(lang, fr, ui) {
  const bat = served(lang, ui, !!fr.practice);
  const hold = lang === 'ur' ? ['جائزہ ختم (کوچ)', 'یہ حصہ ختم کریں'] : ['End test (coach)', 'End this section'];
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
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return window.__T; }, manual: ${!fr.auto}, one_at_a_time: true, dev_tools: ${!!fr.devjump} });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${!fr.auto}, handover: false, ur_fit: true,
    r28: { letter_pick: true, mcq: true, ceiling: true }, speak: speak, embed: true${fr.devjump ? ', devJump: function () {}' : ''} });
  runner.start(); runner.instructionDone(); ${fr.practice ? '' : 'runner.begin(); '}view.render();
  view.setSync({ state: 'synced' });
  view.langBattery('${lang === 'ur' ? 'en' : 'ur'}', SAE.core.normalize(${JSON.stringify(other(lang, ui))}), {});
  (function () { // the coach page's hold buttons over the frame (AssessEngineSlot: fixed top-2 start-2, gap-2, min-h 48)
    var hb = document.createElement('div'); hb.id = 'hold'; hb.setAttribute('dir', '${lang === 'ur' ? 'rtl' : 'ltr'}');
    hb.style.cssText = 'position:fixed;top:8px;inset-inline-start:8px;display:flex;gap:8px;z-index:1001;font:600 12px/16px system-ui,sans-serif';
    ${JSON.stringify(hold)}.forEach(function (t) { var b = document.createElement('button'); b.textContent = t; b.style.cssText = 'min-height:48px;min-width:48px;padding:4px 12px;border:1px solid #cbd5e1;border-radius:12px;background:rgba(255,255,255,.9);font:inherit'; hb.appendChild(b); });
    document.body.appendChild(hb);
  }());
  window.__view = view; window.__runner = runner;
</script></body></html>`;
}

/** In the page: the five cards and the replay pill hit at their centres inside the viewport, the scroll inside the screen. */
const measure = () => document.fonts.ready.then(() => {
  const vh = window.innerHeight;
  const hits = (k) => { const b = k.getBoundingClientRect(); if (b.top < 0 || b.bottom > vh) return false; const e = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return !!e && (e === k || k.contains(e)); };
  const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
  const cards = Array.from(document.querySelectorAll('.sae-pick-cards .sae-opt'));
  const pill = document.querySelector('.sae-pick-replay');
  const back = document.querySelector('.sae-back-item');
  const scr = document.querySelector('.sae-screen');
  const v = window.__runner.view();
  return { ii: v.item_index, phase: v.phase, vh, cards_hit: cards.filter(hits).length, cards_n: cards.length,
    pill_hit: !!pill && hits(pill), pill_bottom: pill ? +pill.getBoundingClientRect().bottom.toFixed(1) : null,
    inner_scroll: over(scr) + over(scr && scr.querySelector('.sae-body')), page_over: Math.max(0, document.documentElement.scrollHeight - vh),
    back: back ? { hit: hits(back), top: +back.getBoundingClientRect().top.toFixed(1), bottom: +back.getBoundingClientRect().bottom.toFixed(1), in_foot: !!back.closest('.sae-foot') } : null,
    devjump: !!document.querySelector('.sae-devjump'),
    // the frame as laid out: the root's classes and lang, the screen's classes and padding-top, the foot
    root: (() => { const r = document.querySelector('.sae'); return r ? { cls: String(r.className), lang: r.getAttribute('lang') } : null; })(),
    screen: scr ? { cls: String(scr.className), pad_top: parseFloat(getComputedStyle(scr).paddingTop), kids: Array.from(scr.children).map((k) => String(k.className).split(' ')[0] + ':' + Math.round(k.getBoundingClientRect().height)) } : null,
    foot: (() => { const f = scr && scr.querySelector(':scope > .sae-foot'); return f ? { top: +f.getBoundingClientRect().top.toFixed(1), bottom: +f.getBoundingClientRect().bottom.toFixed(1), pos: getComputedStyle(f).position, navrow: !!f.querySelector('.sae-navrow') } : null; })(),
    cue: !!document.querySelector('.sae-r9-scroll') && getComputedStyle(document.querySelector('.sae-r9-scroll')).display !== 'none' };
});

maybe('the letter picker under the served switch set (back_button ON), coach-led and RDF auto: no Back; five cards and the replay in reach on every item', () => {
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  async function walk(lang, fr, set, offerNext) {
    const ctx = await browser.newContext({ viewport: fr.vp, deviceScaleFactor: fr.dpr });
    const p = await ctx.newPage();
    const doc = html(lang, fr, set.ui);
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
    const rows = [];
    for (let k = 0; k < 10; k++) {
      await p.evaluate(() => window.__end());
      await p.waitForTimeout(200);
      rows.push(Object.assign({ state: 'item' }, await p.evaluate(measure)));
      if (offerNext && k < 3) { // RDF auto: Next offered on the item (30 s, no answer), before any tap
        for (let j = 0; j < 6; j++) {
          await p.evaluate(() => { window.__T += 16000; window.__view.render(); });
          await p.waitForTimeout(300);
          while (await p.evaluate(() => window.__end())) await p.waitForTimeout(400);
          if (await p.evaluate(() => { window.__view.render(); return !!document.querySelector('.sae-screen .sa-next, .sae-screen .sae-pick-next'); })) break;
        }
        await p.waitForTimeout(200);
        rows.push(Object.assign({ state: 'offernext' }, await p.evaluate(measure), { next: await p.evaluate(() => !!document.querySelector('.sae-screen .sa-next, .sae-screen .sae-pick-next')) }));
      }
      if (process.env.SA_PICK_SHOT_DIR && k === 1) await p.screenshot({ path: path.join(process.env.SA_PICK_SHOT_DIR, `a15_item2${fr.tag}_${set.name}_${lang}_${fr.dev}_${fr.auto ? 'auto' : 'coach'}.png`) });
      // the child's tap on card 3 (at its centre, as a finger): the pressed card, before the next item is drawn
      await p.evaluate(() => { const b = document.querySelectorAll('.sae-pick-cards .sae-opt')[2]; const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); });
      await p.waitForTimeout(60);
      rows.push(Object.assign({ state: 'chosen' }, await p.evaluate(measure)));
      await p.waitForTimeout(600);
      const done = await p.evaluate(() => window.__runner.view().phase !== 'running');
      if (done) break;
    }
    await ctx.close();
    if (process.env.SA_PICK_LOG) fs.appendFileSync(process.env.SA_PICK_LOG, JSON.stringify({ lang, frame: fr.name, set: set.name, rows }) + '\n');
    return rows;
  }
  const bad = (rows) => rows.filter((r) => r.cards_hit !== 5 || !r.pill_hit || r.pill_bottom > r.vh - 8 || r.inner_scroll !== 0 || r.page_over !== 0 || r.cue || r.back)
    .map((r) => `${r.state} ii=${r.ii}: cards ${r.cards_hit}/5 pill ${r.pill_hit ? 'hit' : 'MISS'} @${r.pill_bottom} inner ${r.inner_scroll}${r.cue ? ' cue' : ''} back ${r.back ? (r.back.hit ? 'hit' : 'MISS') + '@' + r.back.top + '-' + r.back.bottom : '-'}`);

  const FRAMES = [
    { name: 'phone', vp: { width: 360, height: 640 }, dpr: 3, dev: 'phone', tag: '' },
    { name: 'phone+devjump', vp: { width: 360, height: 640 }, dpr: 3, dev: 'phone', tag: '_devjump', devjump: true },
    { name: 'phone RDF auto', vp: { width: 360, height: 640 }, dpr: 3, dev: 'phone', tag: '_auto', auto: true },
    { name: 'phone RDF auto+devjump', vp: { width: 360, height: 640 }, dpr: 3, dev: 'phone', tag: '_auto_devjump', auto: true, devjump: true },
    { name: 'tablet', vp: { width: 800, height: 1280 }, dpr: 1.5, dev: 'tablet', tag: '' },
  ];
  for (const set of SETS) for (const fr of FRAMES) {
    for (const lang of ['ur', 'en']) {
      test(`[${set.name} set] ${lang} ${fr.name}: every item (before and after the tap, items 1–10): no Back, 5/5 cards hit, the replay hit and ≤ vh − 8, no inner scroll, no cue`, async () => {
        const rows = await walk(lang, fr, set);
        expect(rows.filter((r) => r.state === 'item').length).toBe(10);
        // the sandbox-only "Jump to…" dev row is not drawn on the picker's item screens (its row took item 1's replay below the fold on a phone)
        expect(rows.filter((r) => r.devjump).length).toBe(0);
        expect(bad(rows)).toEqual([]);
      }, 300000);
    }
  }

  // RDF auto, Next offered (30 s with no answer) on items 1–3, then the tap: the red team's state. Held here: no Back is
  // drawn (Back was the suspect); read and logged: the cards, the replay and the scroll with the child's Next at the foot
  for (const set of SETS) {
    for (const lang of ['ur', 'en']) {
      test(`[${set.name} set] ${lang} phone RDF auto, Next offered on items 1–3: no Back; read`, async () => {
        const fr = { name: 'phone RDF auto offer-next', vp: { width: 360, height: 640 }, dpr: 3, dev: 'phone', tag: '_auto_offernext', auto: true };
        const rows = await walk(lang, fr, set, true);
        expect(rows.filter((r) => r.state === 'offernext' && r.next).length).toBe(3);
        expect(rows.filter((r) => r.back).length).toBe(0);
      }, 300000);
    }
  }

  // O-50 (read): the RDF auto practice screens with the toggle drawn, P1 (modelled) and P2 (before and after a tap)
  for (const set of SETS) {
    for (const lang of ['ur', 'en']) {
      test(`[${set.name} set] ${lang} phone RDF auto, practice P1 and P2: read`, async () => {
        const fr = { name: 'phone RDF auto practice', vp: { width: 360, height: 640 }, dpr: 3, dev: 'phone', auto: true, practice: true };
        const ctx = await browser.newContext({ viewport: fr.vp, deviceScaleFactor: fr.dpr });
        const p = await ctx.newPage();
        const doc = html(lang, fr, set.ui);
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
        const rows = [];
        const read = async (state) => rows.push(Object.assign({ state, pr: await p.evaluate(() => { const v = window.__runner.view(); return v.practice ? v.practice.id : v.phase; }) }, await p.evaluate(measure)));
        await read('p1');
        await p.evaluate(() => window.__end()); await p.waitForTimeout(400);
        await read('p1_modelled');
        for (let j = 0; j < 10 && (await p.evaluate(() => { const v = window.__runner.view(); return !v.practice || v.practice.role === 'example'; })); j++) await p.waitForTimeout(500);
        await p.evaluate(() => window.__end()); await p.waitForTimeout(400);
        await read('p2');
        await p.evaluate(() => { const b = document.querySelectorAll('.sae-pick-cards .sae-opt')[0]; if (b) b.click(); }); await p.waitForTimeout(300);
        await read('p2_feedback');
        await ctx.close();
        if (process.env.SA_PICK_LOG) fs.appendFileSync(process.env.SA_PICK_LOG, JSON.stringify({ lang, frame: fr.name, set: set.name, rows }) + '\n');
        expect(rows.filter((r) => r.cards_n === 5 && r.cards_hit !== 5).map((r) => r.state)).toEqual([]);
      }, 120000);
    }
  }
});

// The spoken MCQ (sa_r28_mcq) under the same served set: from its second question on, no Back at the foot (a Back
// re-opens an answered tap item), the four answers and the replay in reach, no inner scroll.
maybe('the spoken MCQ under the served switch set (back_button ON): no Back on its questions; answers and replay in reach', () => {
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });
  function mcqHtml(lang, manual) {
    const { applySwitches } = require('../routes/sa-battery-switches');
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G2.A.${lang}.json`), 'utf8'));
    const b = applySwitches(raw, ON);
    const t = b.tasks.find((x) => x.id === `${lang}.story_mcq_w3`);
    const bat = { battery_id: b.battery_id || 'b', ui: Object.assign({}, SERVED_UI), tasks: [Object.assign({}, t, { practice: [], depends_on: null })] };
    return `<!doctype html><html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  function speak() { return new Promise(function (r) { setTimeout(r, 20); }); } // every read-out ends at once
  speak.audio = function () { return null; };
  var battery = ${JSON.stringify(bat)};
  var runner = SAE.core.createRunner({ battery: battery, now: function () { return 0; }, manual: ${manual}, onEvent: function () {} });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${manual}, handover: false, ur_fit: true,
    r28: { letter_pick: true, mcq: true, ceiling: true }, speak: speak, embed: true });
  runner.start(); runner.instructionDone(); runner.begin(); view.render(); view.setSync({ state: 'synced' });
  window.__view = view; window.__runner = runner;
</script></body></html>`;
  }
  for (const lang of ['ur', 'en']) {
    for (const manual of [true, false]) {
      test(`${lang} ${manual ? 'coach-led' : 'RDF auto'} phone: questions 2.. draw no Back; no inner scroll`, async () => {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });
        const p = await ctx.newPage();
        const doc = mcqHtml(lang, manual);
        await p.route('**/*', (route) => {
          const u = new URL(route.request().url());
          if (u.pathname.startsWith('/wq/fonts/')) return route.fulfill({ path: path.join(PUB, 'fonts', path.basename(u.pathname)), contentType: 'font/woff2' });
          if (/^\/wq\/jugnu_[a-z]+\.webp$/.test(u.pathname)) return route.fulfill({ path: path.join(PUB, path.basename(u.pathname)), contentType: 'image/webp' });
          if (u.pathname === '/') return route.fulfill({ body: doc, contentType: 'text/html; charset=utf-8' });
          return route.fulfill({ status: 404, body: '' });
        });
        await p.goto('http://sa.test/');
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(1500);
        const rows = [];
        for (let k = 0; k < 8; k++) {
          rows.push(await p.evaluate(() => { const scr = document.querySelector('.sae-screen'); const over = (n) => (n ? Math.max(0, n.scrollHeight - n.clientHeight) : 0);
            const v = window.__runner.view();
            return { ii: v.item_index, mcq: !!document.querySelector('.sae-mcq'), back: !!document.querySelector('.sae-back-item'), inner: over(scr) + over(scr && scr.querySelector('.sae-body')) }; }));
          if (rows[rows.length - 1].ii >= 2) break;
          await p.evaluate(() => { const v = window.__runner.view(); window.__runner.answer(v.item.options ? 0 : 0); window.__view.render(); });
          await p.waitForTimeout(1500);
        }
        await ctx.close();
        if (process.env.SA_PICK_LOG) fs.appendFileSync(process.env.SA_PICK_LOG, JSON.stringify({ lang, frame: 'mcq ' + (manual ? 'coach' : 'auto'), rows }) + '\n');
        expect(rows[rows.length - 1].ii).toBe(2);
        expect(rows.every((r) => r.mcq)).toBe(true);
        expect(rows.filter((r) => r.back || r.inner !== 0).map((r) => `q${r.ii}: back ${r.back} inner ${r.inner}`)).toEqual([]);
      }, 120000);
    }
  }
});
