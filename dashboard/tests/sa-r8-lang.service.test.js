'use strict';
/**
 * Round 8 item 4 (sa_r8_lang_switch): "a toggle for switching language within the test so the coach or the child can
 * switch language during the test if needed".
 *
 * The two batteries of a form (sa.coach.<form>.ur / .en) are the same test: the same tasks and item ids (Urdu reading,
 * English reading, maths); only the instruction language differs (Jugnu's lines, the item prompts, the practice
 * feedback). ON, with the other language's battery handed to the screens (view.langBattery), a small «اردو | English»
 * toggle sits in the top bar. A tap changes nothing on the screen on show (no clip is cut); from the next screen the
 * words and Jugnu's voice are the other language's, one lang_switch event is logged, and the answers already given
 * stay in the same run. An item whose answer is a word of the language (patterns: circle / دائرہ) keeps its own words.
 * OFF: no toggle and the screens exactly as before.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const cp = (s) => Array.from(s).length;

function batteries(ui) {
  const task = (lang) => ({
    id: 'ma.add1', mode: 'tap', lang: null,
    title: { en: 'Adding', ur: 'جمع' },
    script: { intro: { text: lang === 'ur' ? 'جمع کریں۔' : 'Add the numbers.', audio: `sa/v1/${lang}/intro.mp3` } },
    practice: [{ id: 'ma.add1.p1', target: 3, options: [3, 4], say: lang === 'ur' ? '۱ جمع ۲' : '1 plus 2', prompt_audio: `sa/v1/${lang}/p1.mp3`,
      feedback: { correct: { text: lang === 'ur' ? 'شاباش!' : 'Well done!', audio: `sa/v1/${lang}/ok.mp3` }, wrong: { text: lang === 'ur' ? 'جواب ۳ ہے۔' : 'It is 3.' } } }],
    items: [
      { id: 'ma.add1.01', target: 5, options: [5, 6], say: lang === 'ur' ? '۲ جمع ۳' : '2 plus 3', prompt_audio: `sa/v1/${lang}/i1.mp3` },
      { id: 'ma.add1.02', target: 7, options: [7, 8], say: lang === 'ur' ? '۳ جمع ۴' : '3 plus 4', prompt_audio: `sa/v1/${lang}/i2.mp3` },
      // a word of the language is the answer: this item stays in the run's own words
      { id: 'ma.add1.03', target: lang === 'ur' ? 'دائرہ' : 'circle', options: lang === 'ur' ? ['دائرہ', 'تکون'] : ['circle', 'triangle'],
        say: lang === 'ur' ? 'اگلی شکل؟' : 'Which shape is next?', prompt_audio: `sa/v1/${lang}/i3.mp3` },
    ],
  });
  const b = (lang) => Object.assign({
    battery_id: `sa.coach.G3.A.${lang}`, lang,
    lines: { welcome: { text: lang === 'ur' ? 'السلام علیکم!' : 'Hello!', audio: `sa/v1/${lang}/welcome.mp3` } },
    tasks: [task(lang)],
  }, ui ? { ui } : {});
  return { ur: b('ur'), en: b('en') };
}

maybe('round 8 item 4: switch the language during the test (sa-ui, sa_r8_lang_switch)', () => {
  let dom; let views = []; const keep = {};
  beforeEach(() => {
    views = [];
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

  function mount(ui, o = {}) {
    const core = require('../sa/sa-core');
    const saUi = require('../sa/sa-ui');
    const b = batteries(ui);
    const events = [];
    const spoken = [];
    const battery = core.normalize(b.ur);
    const runner = core.createRunner({ battery, onEvent: (e) => events.push(e), audio_check: false, warmup: false, manual: !!o.manual });
    const el = document.getElementById('m');
    const view = saUi.mount(el, { runner, battery, lang: 'ur', mode: o.mode || 'game', manual: !!o.manual,
      speak: (t, a) => { spoken.push({ t, a }); return Promise.resolve(); } });
    views.push(view);
    if (o.alt !== false && typeof view.langBattery === 'function') view.langBattery('en', core.normalize(b.en), o.hooks || {});
    return { runner, el, view, events, spoken };
  }
  const said = (s) => s.map((x) => {
    const t = x.t;
    if (t == null) return null;
    if (typeof t === 'string') return t;
    return t.text != null ? t.text : (t.ur || t.en);
  });
  async function toInstruction(el, runner) {
    if (!el.querySelector('.sae-primary')) runner.start();
    else el.querySelector('.sae-primary').click();
    await flush();
    expect(runner.view().phase).toBe('instruction');
  }
  const toggle = (el) => el.querySelector('.sae-r8-lang');

  test('OFF: no toggle, no class, and the screen is the same as a mount without the other battery', async () => {
    const a = mount(null);
    await toInstruction(a.el, a.runner);
    expect(toggle(a.el)).toBeNull();
    expect(a.el.classList.contains('is-r8-lang')).toBe(false);
    const withAlt = a.el.innerHTML;
    a.view.destroy();
    const b = mount(null, { alt: false });
    await toInstruction(b.el, b.runner);
    expect(b.el.innerHTML).toBe(withAlt);
    expect(b.events.some((e) => e.type === 'lang_switch')).toBe(false);
  });

  test('ON without the other battery (not on the phone): no toggle', async () => {
    const { el, runner } = mount({ r8_lang_switch: true }, { alt: false });
    await toInstruction(el, runner);
    expect(toggle(el)).toBeNull();
  });

  test('ON: the toggle reads «اردو | English», at most 20 code points, in the top bar, current language marked', async () => {
    const { el, runner } = mount({ r8_lang_switch: true });
    await toInstruction(el, runner);
    const t = toggle(el);
    expect(t).not.toBeNull();
    expect(t.closest('.sae-top')).not.toBeNull();
    expect(t.textContent.replace(/\s+/g, ' ').trim()).toBe('اردو | English');
    expect(cp(t.textContent.trim())).toBeLessThanOrEqual(20);
    expect(t.querySelector('.is-on').textContent).toBe('اردو');
    expect(el.classList.contains('is-r8-lang')).toBe(true);
  });

  test('a tap: the screen on show and its clip are untouched; the next screen is English, words and voice', async () => {
    const { el, runner, spoken, events } = mount({ r8_lang_switch: true });
    await toInstruction(el, runner);
    const before = el.querySelector('.sae-body').innerHTML;
    spoken.length = 0;
    toggle(el).click();
    await flush();
    expect(el.querySelector('.sae-body').innerHTML).toBe(before);
    expect(spoken).toEqual([]);
    expect(events.some((e) => e.type === 'lang_switch')).toBe(false);
    expect(toggle(el).querySelector('.is-on').textContent).toBe('English');
    // the next screen: the practice, in English
    el.querySelector('.sae-primary').click();
    await flush();
    expect(runner.view().phase).toBe('practice');
    expect(el.getAttribute('lang')).toBe('en');
    expect(el.getAttribute('dir')).toBe('ltr');
    expect(el.querySelector('.sae-task-tag').textContent).toBe('Adding');
    const last = spoken[spoken.length - 1];
    expect(said([last])[0]).toBe('1 plus 2');
    expect(last.t.lang).toBe('en');
    expect(last.a).toBe('sa/v1/en/p1.mp3');
    const sw = events.filter((e) => e.type === 'lang_switch');
    expect(sw).toHaveLength(1);
    expect(sw[0]).toMatchObject({ task_id: 'ma.add1', value: { from: 'ur', to: 'en' } });
  });

  test('practice feedback after the switch is the English line', async () => {
    const { el, runner, spoken } = mount({ r8_lang_switch: true });
    await toInstruction(el, runner);
    toggle(el).click();
    el.querySelector('.sae-primary').click();
    await flush();
    spoken.length = 0;
    el.querySelector('[data-value="3"]').click();
    await flush();
    expect(el.querySelector('.sae-fb').textContent).toBe('Well done!');
    expect(said(spoken)).toContain('Well done!');
  });

  test('the answers already given stay; the same item ids; a word-answer item keeps its own words and is scored', async () => {
    const { el, runner, spoken, events } = mount({ r8_lang_switch: true });
    await toInstruction(el, runner);
    el.querySelector('.sae-primary').click(); // practice
    await flush();
    el.querySelector('[data-value="3"]').click();
    await flush(1700);
    expect(runner.view().phase).toBe('ready');
    el.querySelector('.sae-primary').click(); // go
    await flush();
    expect(runner.view().phase).toBe('running');
    expect(said([spoken[spoken.length - 1]])[0]).toBe('۲ جمع ۳');
    toggle(el).click();
    el.querySelector('[data-value="5"]').click(); // item 1, answered in Urdu
    await flush(600);
    expect(runner.view().item.id).toBe('ma.add1.02');
    expect(said([spoken[spoken.length - 1]])[0]).toBe('3 plus 4');
    el.querySelector('[data-value="7"]').click();
    await flush(600);
    expect(runner.view().item.id).toBe('ma.add1.03');
    // the shape item: Urdu options and Urdu words still, so the child's tap is scored against its own answer
    expect(el.querySelector('[data-value="دائرہ"]')).not.toBeNull();
    expect(said([spoken[spoken.length - 1]])[0]).toBe('اگلی شکل؟');
    el.querySelector('[data-value="دائرہ"]').click();
    await flush(1500);
    const end = events.find((e) => e.type === 'task_end');
    expect(end).toBeTruthy();
    const answers = end.value.answers.map((a) => [a.item_id, a.ok]);
    expect(answers).toEqual([['ma.add1.01', true], ['ma.add1.02', true], ['ma.add1.03', true]]);
    const sw = events.filter((e) => e.type === 'lang_switch');
    expect(sw).toHaveLength(1);
    expect(sw[0]).toMatchObject({ task_id: 'ma.add1', item_id: 'ma.add1.02', value: { from: 'ur', to: 'en', item_id: 'ma.add1.02' } });
  });

  test('tap twice before the next screen: no switch, no event', async () => {
    const { el, runner, events } = mount({ r8_lang_switch: true });
    await toInstruction(el, runner);
    toggle(el).click();
    toggle(el).click();
    el.querySelector('.sae-primary').click();
    await flush();
    expect(el.getAttribute('lang')).toBe('ur');
    expect(el.querySelector('.sae-task-tag').textContent).toBe('جمع');
    expect(events.some((e) => e.type === 'lang_switch')).toBe(false);
  });

  test('back to Urdu: the run\'s own battery again; the page hears every switch', async () => {
    const heard = [];
    const { el, runner, spoken, events } = mount({ r8_lang_switch: true }, { hooks: { onSwitch: (l) => heard.push(l) } });
    await toInstruction(el, runner);
    toggle(el).click();
    el.querySelector('.sae-primary').click();
    await flush();
    toggle(el).click();
    el.querySelector('[data-value="3"]').click();
    await flush(1700);
    expect(runner.view().phase).toBe('ready');
    expect(el.getAttribute('lang')).toBe('ur');
    expect(heard).toEqual(['en', 'ur']);
    expect(events.filter((e) => e.type === 'lang_switch').map((e) => e.value.to)).toEqual(['en', 'ur']);
    expect(spoken.length).toBeGreaterThan(0);
  });

  test('a built-in line ({en, ur}) after the switch is spoken in English with the English voice', async () => {
    const { el, runner, spoken } = mount({ r8_lang_switch: true });
    await toInstruction(el, runner);
    toggle(el).click();
    el.querySelector('.sae-primary').click();
    await flush();
    spoken.length = 0;
    el.querySelector('[data-value="4"]').click(); // wrong once: the built-in "try again"
    await flush();
    const t = spoken[0].t;
    expect(t.lang).toBe('en');
    expect(typeof t.text).toBe('string');
    expect(t.text).not.toMatch(/[؀-ۿ]/);
  });

  test('coach-led (proctored): the toggle is on the coach-run screens too', async () => {
    const { el, runner } = mount({ r8_lang_switch: true }, { mode: 'proctored' });
    el.querySelector('.sae-primary').click(); // the hand-over
    await flush();
    await toInstruction(el, runner);
    expect(toggle(el)).not.toBeNull();
  });
});

maybe('sa-page: the other language\'s battery for the toggle (sa-page.js langAltOf)', () => {
  test('the same tasks and items, rotated and picked the same way; the other language\'s file name', () => {
    const page = require('../sa/sa-page');
    const b = batteries({ r8_lang_switch: true });
    expect(page.otherForm('sa.coach.G3.A.ur')).toEqual({ form: 'sa.coach.G3.A.en', lang: 'en' });
    expect(page.otherForm('sa.coach.G3.A.en')).toEqual({ form: 'sa.coach.G3.A.ur', lang: 'ur' });
    const alt = page.langAltOf(page.pick(b.ur, null), b.en, null, 'session-1');
    expect(alt.tasks.map((t) => t.id)).toEqual(['ma.add1']);
    expect(alt.lang).toBe('en');
  });
  test('a battery whose tasks are not the same test: null (no toggle)', () => {
    const page = require('../sa/sa-page');
    const b = batteries({ r8_lang_switch: true });
    const other = JSON.parse(JSON.stringify(b.en));
    other.tasks[0].id = 'ma.other';
    expect(page.langAltOf(b.ur, other, null, 's')).toBeNull();
    const fewer = JSON.parse(JSON.stringify(b.en));
    fewer.tasks[0].items = fewer.tasks[0].items.slice(0, 2);
    expect(page.langAltOf(b.ur, fewer, null, 's')).toBeNull();
  });
  test('the real batteries: every form\'s two languages are the same test (task and item ids)', () => {
    const fs = require('fs');
    const path = require('path');
    const page = require('../sa/sa-page');
    const dir = path.join(__dirname, '../../bot/shared/data/child-test/sa');
    const forms = fs.readdirSync(dir).filter((f) => /^sa\.coach\..*\.ur\.json$/.test(f));
    expect(forms.length).toBeGreaterThan(0);
    for (const f of forms) {
      const ur = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const en = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.ur\.json$/, '.en.json')), 'utf8'));
      for (const block of [null, 'rdf', 'B1']) {
        expect(page.langAltOf(page.rotate(page.pick(ur, block), 'x'), en, block, 'x')).not.toBeNull();
      }
    }
  });
});

describe('sa-page: langAltLoad hands the other battery to the screens (sa_r8_lang_switch)', () => {
  const keepSelf = global.self;
  afterEach(() => { global.self = keepSelf; jest.resetModules(); });
  function load(o) {
    jest.resetModules();
    const b = batteries({ r8_lang_switch: true });
    const fetched = [];
    global.self = {
      fetch: async (u) => { fetched.push(u); if (o.fetchFails) throw new Error('offline'); return { ok: true, json: async () => JSON.parse(JSON.stringify(b.en)) }; },
      document: { documentElement: { lang: 'ur', dir: 'rtl' } },
      navigator: { onLine: o.onLine !== false },
    };
    const page = require('../sa/sa-page');
    const core = require('../sa/sa-core');
    const given = [];
    const prepared = [];
    const SAE = { core, offline: { prepare: async (x) => { prepared.push(x); return { ready: o.ready !== false }; } } };
    const engine = { view: { langBattery: (l, bat, hooks) => given.push({ l, bat, hooks }) } };
    const p = { form: 'sa.coach.G3.A.ur', lang: 'ur', block: null, session_id: 'session-1' };
    return page.langAltLoad(SAE, p, page.rotate(page.pick(b.ur, null), 'session-1'), Promise.resolve(), engine)
      .then((r) => ({ r, given, fetched, prepared, doc: global.self.document }));
  }
  test('fetched by its file name, kept on the phone, handed over normalised; a switch sets the page language', async () => {
    const { r, given, fetched, prepared, doc } = await load({});
    expect(r).toBe('en');
    expect(fetched).toEqual(['/sa/batteries/sa.coach.G3.A.en.json']);
    expect(prepared[0]).toMatchObject({ battery_url: '/sa/batteries/sa.coach.G3.A.en.json', lang: 'en' });
    expect(given).toHaveLength(1);
    expect(given[0].l).toBe('en');
    expect(given[0].bat.tasks[0].__sa).toBe(true);
    given[0].hooks.onSwitch('en');
    expect(doc.documentElement).toEqual({ lang: 'en', dir: 'ltr' });
  });
  test('not reachable: no toggle (nothing handed over), no error', async () => {
    const { r, given } = await load({ fetchFails: true });
    expect(r).toBeNull();
    expect(given).toEqual([]);
  });
  test('offline and its pictures not kept: no toggle', async () => {
    const { r, given } = await load({ ready: false, onLine: false });
    expect(r).toBeNull();
    expect(given).toEqual([]);
  });
});
