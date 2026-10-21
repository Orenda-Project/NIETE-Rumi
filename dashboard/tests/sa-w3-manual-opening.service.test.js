'use strict';
/**
 * Wave 3 follow-ups on the page (dashboard/sa/sa-ui.js, sa.css):
 *   RDF manual, the session opening: the welcome and the bubbles lines are silent; the sound check stays voiced (its
 *     prompt, its word and its replay: the coach line needs a working speaker); the coach's first screen says to put
 *     the headphones on the child. The keypad warm-up, oral practice and hand-back lines are silent too.
 *   The printed passage box: line-height ≈ 1.6 (EN) / ≈ 2.45 (UR, RULING W3-19), word gap ≈ .35em, the font one step down at ≤ 360 px;
 *     one row per sentence when the words carry line = sentence.
 *   The sandbox Jump select sits below the coach's corner hold (top-start, about 56 px tall).
 * DOM tests: NODE_PATH=../portal/node_modules (jsdom).
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
const LINE = { en: 'Your coach will now give the instructions.', ur: 'اب آپ کے کوچ ہدایات دیں گے۔' };
const HEADPHONES = { en: 'Put the headphones on the child, then check the sound.', ur: 'بچے کو ہیڈفون لگائیں، پھر آواز چیک کریں۔' };

maybe('sa-ui: the RDF manual opening', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  const flush = (ms) => new Promise((r) => setTimeout(r, ms || 20));
  const words = (x, lang) => (x == null ? '' : typeof x === 'string' ? x : x.text || x[lang] || x.en || x.ur || '');
  function mount(battery, runnerOpts, uiOpts) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    const runner = core.createRunner(Object.assign({ battery, now: () => 0, mic: () => 'ok' }, runnerOpts));
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'proctored', speak: (x) => { said.push(x); return Promise.resolve(); } }, uiOpts));
    views.push(view);
    return { runner, el, view, said };
  }
  const button = (el, label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label);
  const task = { id: 'en.letters', response: 'record', lang: 'en', time_limit_s: 60, grid: ['m'], items: [], instruction: { text: 'Tell me the names of these letters.' } };
  const lines = { welcome: { en: 'Assalam o alaikum! Welcome.', ur: 'السلام علیکم!' }, audio_check: { en: 'Can you hear Jugnu?', ur: 'کیا آپ کو جگنو کی آواز آ رہی ہے؟' } };

  test.each(['en', 'ur'])('%s: the coach\'s first screen says to put the headphones on; the welcome and bubbles are silent; the sound check speaks', async (lang) => {
    const b = { battery_id: 'b', tasks: [task], lines };
    const { runner, el, view, said } = mount(b, { manual: true, audio_check: true, warmup: true }, { manual: true, lang });
    view.render(); await flush();
    expect(el.querySelector('.sae-handover .sae-headphones').textContent).toBe(HEADPHONES[lang]);
    button(el, lang === 'ur' ? 'شروع کریں' : 'Start').click(); await flush();
    expect(said).toEqual([]);
    el.querySelector('.sae-intro .sae-primary').click(); await flush();
    expect(runner.view().phase).toBe('audio_check');
    const check = said.map((x) => words(x, lang));
    expect(check[0]).toBe(words(lines.audio_check, lang));
    expect(check).toHaveLength(2);
    said.length = 0;
    el.querySelector('.sae-check .sae-replay').click(); await flush();
    expect(said).toHaveLength(1);
    said.length = 0;
    const target = [...el.querySelectorAll('.sae-check .sae-pic')].find((x) => x.getAttribute('aria-label'));
    runner.audioCheck(true); view.render(); await flush();
    expect(target).toBeTruthy();
    expect(runner.view().phase).toBe('warmup');
    expect(said).toEqual([]);
  });

  test('auto: the welcome and the bubbles still speak; no headphones line', async () => {
    const b = { battery_id: 'b', tasks: [task], lines };
    const { runner, el, view, said } = mount(b, { audio_check: true, warmup: true }, {});
    view.render(); await flush();
    expect(el.querySelector('.sae-headphones')).toBeNull();
    button(el, 'Start').click(); await flush();
    expect(said.map((x) => words(x, 'en'))).toEqual([lines.welcome.en]);
    runner.start(); view.render(); await flush();
    runner.audioCheck(true); view.render(); await flush();
    expect(runner.view().phase).toBe('warmup');
    expect(said.map((x) => words(x, 'en'))).toContain('Pop the bubbles!');
  });

  test('manual: the keypad warm-up, oral practice and hand-back lines are silent; only the coach line plays', async () => {
    const keys = { id: 'ma.missing', mode: 'keypad', subtask: 'missing_number', items: [{ id: 'k1', shown: ['1', '2', '__'], target: '3' }] };
    const oral = { id: 'ma.oral', mode: 'oral', subtask: 'word_problems', items: [{ id: 'o1', say: 'Two and two', target: '4' }] };
    const b = { battery_id: 'b', tasks: [keys, oral] };
    const { runner, view, said } = mount(b, { manual: true, keypad_warmup: true, oral_practice: true }, { manual: true });
    runner.start(); view.render(); await flush();
    expect(runner.view().phase).toBe('keypad_warmup');
    runner.keypadWarmupDone(3); view.render(); await flush();
    runner.instructionDone(); runner.begin(); runner.answer('3'); view.render(); await flush(1700);
    runner.next(); view.render(); await flush();
    if (runner.view().phase === 'oral_practice') { runner.oralPracticeDone(true); view.render(); await flush(); }
    runner.instructionDone(); runner.begin(); runner.answer('spoken'); view.render(); await flush(1700);
    runner.next(); view.render(); await flush();
    expect(runner.view().phase).toBe('battery_end');
    expect(said.map((x) => words(x, 'en'))).toEqual([LINE.en, LINE.en]);
  });

  test('the printed passage: select2024 with line = sentence draws one row per sentence', async () => {
    const t = form('sa.coach.G3.A.ur.json').tasks.find((x) => x.id === 'ur.story_w3');
    const v = t.variants.find((x) => x.id === 'select2024');
    const tokens = v.passage.text.split(/\s+/).filter(Boolean);
    const { passageWords } = require('../sa/sa-ui');
    const printed = passageWords({ passage: v.passage, items: v.items });
    let s = 1;
    const items = v.items.map((it, i) => { const out = { ...it, line: s }; if (/[۔؟!]$/.test(printed[i])) s += 1; return out; });
    const sentences = (v.passage.text.match(/[۔؟!](\s|$)/g) || []).length;
    expect(sentences).toBe(8);
    expect(tokens.length).toBeGreaterThanOrEqual(items.length);
    const task2 = { ...t, passage: v.passage, items };
    delete task2.variants; delete task2.depends_on;
    const { runner, el, view } = mount({ battery_id: 'b', tasks: [task2] }, {}, { passage_punct: true, lang: 'ur' });
    runner.start(); runner.instructionDone();
    while (runner.view().phase === 'practice') runner.practiceAnswer(runner.view().practice.target);
    runner.begin(); view.render(); await flush();
    expect(el.querySelectorAll('.sae-passage.is-printed .sae-pline')).toHaveLength(8);
  });
});

describe('sa.css: the printed passage box and the Jump row', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8');
  const rule = (sel, src) => {
    const m = (src || css).match(new RegExp('(^|\\}|\\*/)\\s*' + sel.replace(/[.[\]=()]/g, (c) => `\\${c}`) + '\\{([^}]*)\\}'));
    return m ? m[2] : '';
  };
  const num = (decl, prop) => { const m = decl.match(new RegExp('(^|;)' + prop + ':([\\d.]+)')); return m ? Number(m[2]) : null; };

  test('line-height ≈ 1.6 (EN) and ≈ 2.45 (UR, RULING W3-19); word gap ≈ .35em', () => {
    expect(num(rule('.sae-passage.is-printed'), 'line-height')).toBeCloseTo(1.6, 1);
    expect(num(rule('.sae-passage.is-printed[lang=ur]'), 'line-height')).toBeCloseTo(2.45, 2);
    expect(num(rule('.sae-passage.is-printed'), 'word-spacing')).toBeCloseTo(0.35, 2);
    expect(num(rule('.sae-passage.is-printed[lang=ur]'), 'word-spacing') || 0.35).toBeCloseTo(0.35, 2);
  });

  test('at ≤ 360 px the passage font is one step down (EN and UR)', () => {
    const m = css.match(/@media \(max-width:\s*360px\)\{([\s\S]*?\})\}/);
    expect(m).not.toBeNull();
    const small = m[1];
    expect(num(rule('.sae-passage.is-printed', small), 'font-size')).toBeLessThan(num(rule('.sae-passage'), 'font-size'));
    expect(num(rule('.sae-passage.is-printed[lang=ur]', small), 'font-size')).toBeLessThan(num(rule('.sae-passage[lang=ur]'), 'font-size'));
  });

  test('the Jump row starts below the coach\'s corner hold (top-start, 56 px)', () => {
    expect(num(rule('.sae-devjump-row'), 'margin-top')).toBeGreaterThanOrEqual(56);
  });
});
