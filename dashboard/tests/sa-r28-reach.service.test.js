'use strict';
/**
 * Round 28 (data only): can the child reach every answer card? At each letter-sound picker item and each story question
 * (MCQ) the screen, once drawn and settled (fonts ready, then two frames), counts its hit-testable cards: a card whose
 * centre, asked of document.elementFromPoint, is the card or inside it. One event per item:
 *   cards_reach   { task_id, item_id, value: { n, hit, vw, vh } }   (the picker's letter cards)
 *   options_reach { task_id, item_id, value: { n, hit, vw, vh } }   (the story question's answer cards)
 * Coach-led and RDF auto, Urdu and English. A page that cannot hit-test (no elementFromPoint) logs nothing. Both tasks
 * exist only under their own switches, so neither event needs a switch of its own. Fixtures are synthetic.
 */
const path = require('path');
const fs = require('fs');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  try { ({ JSDOM } = require(path.join(__dirname, '../../portal/node_modules/jsdom'))); } catch (__) { /* not installed here */ }
}
const maybe = JSDOM ? describe : describe.skip;

const SETS = {
  ur: { pool: ['ب', 'پ', 'ت', 'ٹ', 'ث', 'ن', 'م', 'ک', 'س', 'ر', 'ج', 'د'], targets: ['ب', 'م', 'ک'] },
  en: { pool: ['b', 'd', 'p', 'q', 'm', 'n', 'w', 'u', 's', 'r', 'l', 'h'], targets: ['m', 's', 'b'] },
};
function pickTask(lang) {
  const set = SETS[lang];
  const id = `${lang}.letter_pick10`;
  const items = set.targets.map((target, i) => {
    const options = set.pool.filter((x) => x !== target).slice(i, i + 4);
    options.splice(i % 5, 0, target);
    return { id: `${id}.${String(i + 1).padStart(2, '0')}`, options, target, prompt_audio: `sa/v5/${lang}/ls_${i + 1}.mp3`, prompt_text: target, src: 'fixture' };
  });
  return {
    id, w3: true, r28: 'letter_pick', replaces: `${lang}.letter_sounds5`, kind: 'pick', response: 'tap', subtask: 'letter_sound_identification',
    lang, title: { en: 'Listen and pick', ur: 'سنیں اور چنیں' }, time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15,
    instruction: { text: 'instruction', audio: `sa/v5/${lang}/lp_intro.mp3` }, script: {}, coach_text: { text: 'coach', src: 'fixture' }, items, practice: [],
  };
}
function mcqTask(lang) {
  const q = (n) => ({ id: `${lang}.story_w3.q${n}`, prompt: { text: `question ${n}`, audio: `sa/v5/${lang}/syn_q${n}.mp3` },
    options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`], option_audio: [1, 2, 3, 4].map((k) => `sa/v5/${lang}/syn_q${n}_o${k}.mp3`), target_index: 1, key: 2, src: 'synthetic' });
  return {
    id: `${lang}.story_mcq_w3`, w3: true, r28: 'mcq', replaces: `${lang}.story_comp_w3`, kind: 'mcq', response: 'tap', subtask: 'reading_comprehension',
    lang, title: { en: 'Story questions', ur: 'کہانی کے سوال' }, time_limit_s: null, stop: {}, replay_at_s: 10, next_at_s: 15, depends_on: null, items: [q(1), q(2)],
  };
}
const KINDS = {
  pick: { task: pickTask, sel: '.sae-pick-cards .sae-opt', type: 'cards_reach', n: 5, ui: { r28_letter_pick: true }, r28: { letter_pick: true, mcq: false, ceiling: false } },
  mcq: { task: mcqTask, sel: '.sae-mcq-opt', type: 'options_reach', n: 4, ui: { r28_mcq: true }, r28: { letter_pick: false, mcq: true, ceiling: false } },
};
const CASES = [];
['pick', 'mcq'].forEach((kind) => ['ur', 'en'].forEach((lang) => [true, false].forEach((manual) => CASES.push([kind, lang, manual ? 'coach-led' : 'RDF auto', manual]))));

maybe('the cards a child can reach, read at each item (jsdom: a laid-out stand-in)', () => {
  let dom;
  const keep = {};
  let views = [];
  afterEach(() => {
    views.forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); views = [];
    for (const k of Object.keys(keep)) global[k] = keep[k];
    if (dom) dom.window.close();
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * The page with a stand-in layout: the cards in a 2 + 3 (or one-per-row) grid of 80 px cells from y 200; `cover` lays
   * an overlay over every card from that index on (the lower row). elementFromPoint answers the card's ink span (a
   * descendant), the overlay over it, or nothing outside every card. hitTest: false leaves jsdom's page as it is.
   */
  function setup(kind, o) {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    const sel = KINDS[kind].sel;
    const cards = () => Array.from(dom.window.document.querySelectorAll(sel));
    const rectOf = (i) => ({ left: (i % 3) * 100, top: 200 + Math.floor(i / 3) * 100, width: 80, height: 80 });
    const overlay = dom.window.document.createElement('div');
    if (o.hitTest !== false) {
      dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
        const i = cards().indexOf(this);
        const r = i >= 0 ? rectOf(i) : { left: 0, top: 0, width: 0, height: 0 };
        return Object.assign({ right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }, r);
      };
      dom.window.document.elementFromPoint = (x, y) => {
        const all = cards();
        for (let i = 0; i < all.length; i++) {
          const r = rectOf(i);
          if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
            if (o.cover != null && i >= o.cover) return overlay;
            // the coach's open fold, laid over the lower row (a fold box over the cards)
            if (o.foldCover != null && i >= o.foldCover && dom.window.document.querySelector('#m details[open]')) return overlay;
            return all[i].firstElementChild || all[i];
          }
        }
        return null;
      };
    }
    jest.resetModules();
  }
  function mount(kind, lang, manual, clock) {
    const k = KINDS[kind];
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', ui: Object.assign({}, k.ui), tasks: [k.task(lang)] };
    const events = [];
    const runner = core.createRunner(Object.assign({ battery, onEvent: (e) => events.push(e), manual }, clock ? { now: clock } : {}));
    const speak = (t, a, vo) => (vo && vo.clip_only ? new Promise(() => {}) : new Promise(() => {}));
    speak.audio = () => null;
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'proctored', manual, handover: false, speak, r28: k.r28 });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); view.render();
    return { runner, view, events, of: (type) => events.filter((e) => e.type === type) };
  }

  test.each(CASES)('%s, %s, %s: every card free → hit === n, one event for the item on show', async (kind, lang, _, manual) => {
    setup(kind, {});
    const m = mount(kind, lang, manual);
    await wait(120);
    const k = KINDS[kind];
    const got = m.of(k.type);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ task_id: k.task(lang).id, item_id: k.task(lang).items[0].id, value: { n: k.n, hit: k.n, vw: expect.any(Number), vh: expect.any(Number) } });
    expect(JSON.stringify(got[0].value).length).toBeLessThanOrEqual(300);
  });

  test.each(CASES)('%s, %s, %s: an overlay over the lower row → hit < n', async (kind, lang, _, manual) => {
    setup(kind, { cover: 3 });
    const m = mount(kind, lang, manual);
    await wait(120);
    const got = m.of(KINDS[kind].type);
    expect(got).toHaveLength(1);
    expect(got[0].value).toMatchObject({ n: KINDS[kind].n, hit: 3 });
  });

  test.each([['pick'], ['mcq']])('%s: the next item is read again, once', async (kind) => {
    setup(kind, {});
    const m = mount(kind, 'ur', true);
    await wait(120);
    if (kind === 'mcq') m.runner.promptDone();
    m.runner.answer(kind === 'mcq' ? 1 : m.runner.view().item.target);
    m.view.render();
    await wait(120);
    const ids = m.of(KINDS[kind].type).map((e) => e.item_id);
    expect(ids).toEqual([KINDS[kind].task('ur').items[0].id, KINDS[kind].task('ur').items[1].id]);
  });

  /**
   * The offer: a second read when the item first offers Next (value.at 'offer'; the first is 'draw'), at most one per
   * item. Both rows say whether the coach's fold was open over the screen at the read (value.fold): the fold open at
   * the offer, laid over the lower card row, reads hit < n with fold true, while the draw read hit = n with fold false.
   */
  /** The item's sound has ended (the picker: its first play and the one auto replay; the MCQ: the read-out), so the wait
   *  for Next counts from now. `later` moves the clock past the picker's auto replay (10 s). */
  async function quiet(m, kind, later) {
    const it = m.runner.view().item;
    if (kind !== 'pick') { m.runner.promptDone(); return; }
    m.runner.clipPlaying(it.id, false);
    later(); await wait(400);
    m.runner.clipPlaying(it.id, false);
  }
  async function toOffer(kind, lang, manual, foldOpen) {
    setup(kind, { foldCover: 3 });
    let T = 1000000;
    const m = mount(kind, lang, manual, () => T);
    await wait(kind === 'pick' && !foldOpen ? 450 : 120); // the picker's sound starts 300 ms after the item shows
    await quiet(m, kind, () => { T += 11000; });
    if (foldOpen) {
      const d = document.querySelector(kind === 'pick' ? 'details.sae-pick-coach' : 'details.sae-mcq-coach');
      d.open = true;
      await wait(60);
    }
    T += 31000; // past the round-28 wait for Next (15 s coach-led, 30 s RDF auto): the item offers Next
    await wait(200);
    return m;
  }

  test.each(CASES)('%s, %s, %s: the draw row and one offer row, each with at and fold', async (kind, lang, _, manual) => {
    const m = await toOffer(kind, lang, manual, false);
    const k = KINDS[kind];
    const rows = m.of(k.type);
    expect(rows.map((e) => e.value.at)).toEqual(['draw', 'offer']);
    rows.forEach((e) => {
      expect(e.item_id).toBe(k.task(lang).items[0].id);
      expect(e.value).toEqual({ n: k.n, hit: k.n, vw: expect.any(Number), vh: expect.any(Number), at: e.value.at, fold: false });
      expect(JSON.stringify(e.value).length).toBeLessThanOrEqual(300);
    });
  });

  test.each(CASES.filter((c) => c[3]))('%s, %s, %s: the fold open over the lower row at the offer → offer {hit < n, fold: true}; draw {hit = n, fold: false}', async (kind, lang) => {
    const m = await toOffer(kind, lang, true, true);
    const k = KINDS[kind];
    const rows = m.of(k.type);
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toMatchObject({ at: 'draw', n: k.n, hit: k.n, fold: false });
    expect(rows[1].value).toMatchObject({ at: 'offer', n: k.n, hit: 3, fold: true });
  });

  test.each([['pick'], ['mcq']])('%s: one offer row per item, however long the offer stays', async (kind) => {
    let T = 1000000;
    setup(kind, {});
    const m = mount(kind, 'ur', false, () => T);
    await wait(kind === 'pick' ? 450 : 120);
    await quiet(m, kind, () => { T += 11000; });
    T += 31000; await wait(200);
    T += 30000; await wait(200);
    m.view.render(); await wait(120);
    expect(m.of(KINDS[kind].type).map((e) => e.value.at)).toEqual(['draw', 'offer']);
  });

  test.each([['pick'], ['mcq']])('%s: a page that cannot hit-test logs nothing', async (kind) => {
    setup(kind, { hitTest: false });
    delete dom.window.document.elementFromPoint;
    const m = mount(kind, 'en', false);
    await wait(120);
    expect(m.of(KINDS[kind].type)).toHaveLength(0);
  });

  test('a tap task that is neither the picker nor a story question logs neither event', async () => {
    setup('pick', {});
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', tasks: [{ id: 'ma.after', mode: 'tap', items: [{ id: 'a1', target: '1', options: ['1', '2'] }] }] };
    const events = [];
    const runner = core.createRunner({ battery, onEvent: (e) => events.push(e) });
    const speak = () => new Promise(() => {});
    const view = ui.mount(document.getElementById('m'), { runner, battery, lang: 'en', mode: 'proctored', handover: false, speak, r28: KINDS.pick.r28 });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); view.render();
    await wait(120);
    expect(events.filter((e) => e.type === 'cards_reach' || e.type === 'options_reach')).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// A real browser lays the screen out (jsdom has none): a 360×640 phone, sa.css, the cards as the child sees them. The
// read is the page's own, with nothing stubbed; a fixed overlay from the last card's top down covers the lower cards.
// Skipped, never red, where there is no playwright-core (PWCORE=<path>) or no chromium.
// ------------------------------------------------------------------------------------------------------------------
let pwChromium = null;
try { ({ chromium: pwChromium } = require(process.env.PWCORE || 'playwright-core')); } catch (_) { /* no browser here */ }
const PW_EXE = process.env.PWCHROME_EXE || (pwChromium ? (() => { try { return pwChromium.executablePath(); } catch (_) { return null; } })() : null);
const maybeBrowser = pwChromium && PW_EXE && fs.existsSync(PW_EXE) ? describe : describe.skip;

maybeBrowser('the cards a child can reach, in a real browser (360×640)', () => {
  const SA = path.join(__dirname, '..', 'sa');
  let browser;
  beforeAll(async () => { browser = await pwChromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {}); });
  afterAll(async () => { if (browser) await browser.close(); });

  function html(kind, lang, manual, cover) {
    const k = KINDS[kind];
    const battery = { battery_id: 'b', ui: k.ui, tasks: [k.task(lang)] };
    return `<!doctype html><html lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fs.readFileSync(path.join(SA, 'sa.css'), 'utf8')}</style></head><body style="margin:0"><main id="m"></main>
<script>${fs.readFileSync(path.join(SA, 'sa-core.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(SA, 'sa-ui.js'), 'utf8')}</script>
<script>
  window.__events = [];
  function speak() { return new Promise(function () {}); }
  speak.audio = function () { return null; };
  var battery = ${JSON.stringify(battery)};
  var runner = SAE.core.createRunner({ battery: battery, manual: ${manual}, onEvent: function (e) { window.__events.push(e); } });
  var view = SAE.ui.mount(document.getElementById('m'), { runner: runner, battery: battery, lang: '${lang}', mode: 'proctored', manual: ${manual}, handover: false,
    ur_fit: true, r28: ${JSON.stringify(k.r28)}, speak: speak });
  runner.start(); runner.instructionDone(); runner.begin(); view.render();
  ${cover ? `(function () {
    var cs = document.querySelectorAll('${k.sel}');
    var b = cs[cs.length - 1].getBoundingClientRect();
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.2);top:' + Math.floor(b.top) + 'px';
    document.body.appendChild(ov);
  }());` : ''}
</script></body></html>`;
  }
  async function read(kind, lang, manual, cover) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    await pg.setContent(html(kind, lang, manual, cover));
    await pg.waitForFunction((t) => window.__events.some((e) => e.type === t), KINDS[kind].type, { timeout: 5000 });
    const got = await pg.evaluate((t) => window.__events.filter((e) => e.type === t), KINDS[kind].type);
    await ctx.close();
    return got;
  }

  test.each(CASES)('%s, %s, %s: free → hit === n; the last card covered → hit < n', async (kind, lang, _, manual) => {
    const k = KINDS[kind];
    const free = await read(kind, lang, manual, false);
    expect(free).toHaveLength(1);
    expect(free[0]).toMatchObject({ task_id: k.task(lang).id, item_id: k.task(lang).items[0].id, value: { n: k.n, hit: k.n, vw: 360, vh: 640 } });
    const covered = await read(kind, lang, manual, true);
    expect(covered[0].value.n).toBe(k.n);
    expect(covered[0].value.hit).toBeLessThan(k.n);
  }, 30000);
});
