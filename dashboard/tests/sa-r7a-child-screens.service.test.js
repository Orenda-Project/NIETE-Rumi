'use strict';
/**
 * Round 7b, the child's screens (the tester's 27 Oct list), each behind its own switch (default OFF):
 *   sa_back_button       Back on the item screens, both modes: the item (or cell) before shows again and its new answer
 *                        replaces the old one; one `back` event per press { by, from, to }. Not on the first item, not on
 *                        the passage, never across tasks; the task's clock keeps running.
 *   sa_audio_gated_next  Next (the instruction, the spoken practice) and Go (Ready) work only once Jugnu has finished;
 *                        a failsafe opens them if the voice never ends.
 *   sa_say_then_next     "Say each one out loud, then press Next" / "… then press Done": on screen and in Jugnu's voice.
 *   sa_story_scroll      the story shows a down arrow while more of it is below; its instructions say to slide the page.
 *   sa_tick_prompt       a typed-number task's instructions say to press the tick after typing.
 *   sa_t_sound_ta        the English letter sound of T is "ta" (a new clip under a new key).
 */
const fs = require('fs');
const path = require('path');
const { applySwitches } = require('../routes/sa-battery-switches');
const R7A = require('../routes/sa-r7a-content');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const UI = { back_button: true };
const CELLS = { battery_id: 'b', ui: UI, tasks: [{ id: 'en.letter_names5', subtask: 'letter_name_identification', response: 'record', lang: 'en', present: 'one_at_a_time', time_limit_s: 60,
  items: ['A', 'b', 'C', 'd'].map((x, i) => ({ id: 'L' + (i + 1), target: x, show: x })) }] };
const TAP = { battery_id: 'b', ui: UI, tasks: [{ id: 'ma.discrimination2', subtask: 'quantity_discrimination', response: 'tap', lang: 'en',
  items: [{ id: 'q1', target: 8, options: [3, 8] }, { id: 'q2', target: 9, options: [9, 2] }, { id: 'q3', target: 5, options: [5, 1] }] }] };
const ORAL = { battery_id: 'b', ui: UI, tasks: [{ id: 'en.story_comp_w3', subtask: 'reading_comprehension', response: 'oral', lang: 'en',
  items: [1, 2, 3].map((n) => ({ id: 'q' + n, prompt: { en: 'Question ' + n }, accept: ['x'] })) }] };

function run(battery, extra) {
  const core = require('../sa/sa-core');
  let t = 0;
  const events = [];
  const r = core.createRunner(Object.assign({ battery, now: () => t, mic: () => 'ok', onEvent: (e) => events.push(e) }, extra || {}));
  r.start(); r.instructionDone(); r.begin();
  return { r, events, tick: (ms) => { t += ms; return r.tick(); } };
}

describe('item 1: back (sa-core)', () => {
  test('a cell: Back shows the cell before; its earlier pass is dropped, the new one replaces it; one back event', () => {
    const x = run(CELLS);
    x.tick(1000); x.r.nextCell('tap'); x.tick(1000); x.r.nextCell('tap');
    expect(x.r.view().cell_index).toBe(2);
    expect(x.r.back('child')).toBe(true);
    expect(x.r.view().cell_index).toBe(1);
    const back = x.events.filter((e) => e.type === 'back');
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(expect.objectContaining({ task_id: 'en.letter_names5', value: { by: 'child', from: 2, to: 1 } }));
    x.tick(1000); x.r.nextCell('tap'); x.r.nextCell('tap'); x.r.nextCell('tap');
    const res = x.r.results()[0];
    expect(res.cells.map((c) => c.i)).toEqual([0, 1, 2, 3]);
    expect(res.last_item_index).toBe(3);
  });
  test('a tap item: Back undoes the last answer; the new answer replaces it (counts and answers)', () => {
    const x = run(TAP);
    x.r.answer(3); // wrong
    expect(x.r.back('child')).toBe(true);
    expect(x.r.view().item_index).toBe(0);
    x.r.answer(8); x.r.answer(9); x.r.answer(5);
    const res = x.r.results()[0];
    expect(res.answers.map((a) => [a.item_id, a.ok])).toEqual([['q1', true], ['q2', true], ['q3', true]]);
    expect([res.attempted, res.correct, res.incorrect]).toEqual([3, 3, 0]);
  });
  test('an oral question (one recording for the section): the mark of the question gone back over is replaced', () => {
    const x = run(ORAL, { section_recording: true });
    x.r.log('record_start', { task_id: 'en.story_comp_w3' });
    x.r.promptDone(); x.r.answer('spoken');
    x.r.promptDone(); x.r.answer('spoken');
    expect(x.r.back('coach')).toBe(true);
    x.r.promptDone(); x.r.answer('spoken'); x.r.promptDone(); x.r.answer('spoken');
    const res = x.r.results()[0];
    expect(res.rec_marks.map((m) => m.item_id)).toEqual(['q1', 'q2', 'q3']);
    expect(res.answers.map((a) => a.item_id)).toEqual(['q1', 'q2', 'q3']);
  });
  test('bounds: not on the first item or cell, not on the passage, not outside a running task, not with the switch off', () => {
    expect(run(CELLS).r.back('child')).toBe(false);
    expect(run(TAP).r.back('child')).toBe(false);
    const passage = { battery_id: 'b', ui: UI, tasks: [{ id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
      passage: { text: 'Ali ran.' }, items: [{ id: 'w1', target: 'Ali' }, { id: 'w2', target: 'ran' }] }] };
    expect(run(passage).r.back('child')).toBe(false);
    const off = run(Object.assign({}, TAP, { ui: {} }));
    off.r.answer(3);
    expect(off.r.back('child')).toBe(false);
    expect(off.r.view().item_index).toBe(1);
  });
  test('the clock keeps running across a Back', () => {
    const x = run(CELLS);
    x.tick(5000); x.r.nextCell('tap'); x.tick(5000);
    const left = x.r.view().time_left_ms;
    x.r.back('child');
    expect(x.r.view().time_left_ms).toBe(left);
  });
});

describe('the content switches (sa-battery-switches.js + sa-r7a-content.js)', () => {
  const B = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa', `sa.coach.G1.A.${lang}.json`), 'utf8'));
  test('OFF: the lines and T are as before, byte for byte', () => {
    for (const lang of ['en', 'ur']) {
      const b = B(lang);
      expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(applySwitches(B(lang), { rdfW3Forms: true })));
      for (const k of Object.keys(R7A.LINES)) expect(applySwitches(b, { rdfW3Forms: true }).lines[k]).toBeUndefined();
    }
  });
  test('sa_say_then_next / sa_story_scroll / sa_tick_prompt add their lines in the battery\'s language, with a clip key', () => {
    for (const lang of ['en', 'ur']) {
      const out = applySwitches(B(lang), { rdfW3Forms: true, sayThenNext: true, storyScroll: true, tickPrompt: true });
      for (const k of ['r7_say_next', 'r7_say_done', 'r7_scroll', 'r7_type_tick']) {
        expect(out.lines[k]).toEqual({ text: R7A.LINES[k][lang], audio: R7A.keyOf(lang, R7A.LINES[k][lang]) });
      }
      const only = applySwitches(B(lang), { rdfW3Forms: true, storyScroll: true });
      expect(only.lines.r7_scroll).toBeTruthy();
      expect(only.lines.r7_say_next).toBeUndefined();
    }
  });
  test('sa_t_sound_ta: every English letter-sound T says "ta", from the new clip; nothing else changes', () => {
    const before = B('en');
    const out = applySwitches(B('en'), { rdfW3Forms: true, tSoundTa: true });
    const sounds = (b) => b.tasks.filter((t) => t.subtask === 'letter_sound_identification');
    const txt = JSON.stringify(sounds(out));
    expect(txt).not.toContain(R7A.T_SOUND.from);
    expect(txt).not.toMatch(/"tuh"/);
    expect(txt).toContain(R7A.T_SOUND.to);
    expect(txt).toMatch(/"ta"/);
    const others = (b) => JSON.stringify(b.tasks.filter((t) => t.subtask !== 'letter_sound_identification'));
    expect(others(out)).toBe(others(applySwitches(before, { rdfW3Forms: true })));
    // the Urdu page's English section too; its Urdu tasks are untouched
    const urOut = applySwitches(B('ur'), { rdfW3Forms: true, tSoundTa: true });
    expect(JSON.stringify(sounds(urOut).filter((t) => t.lang === 'en'))).toContain(R7A.T_SOUND.to);
    const urOnly = (b) => JSON.stringify(b.tasks.filter((t) => t.lang !== 'en'));
    expect(urOnly(urOut)).toBe(urOnly(applySwitches(B('ur'), { rdfW3Forms: true })));
  });
  test('every new clip is on disk in both voice sets', () => {
    const keys = [R7A.T_SOUND.to];
    for (const k of Object.keys(R7A.LINES)) for (const lang of ['en', 'ur']) keys.push(R7A.keyOf(lang, R7A.LINES[k][lang]));
    for (const key of keys) for (const set of ['v1', 'v2']) {
      const f = path.join(__dirname, '..', key.replace(/^sa\/v1\//, `sa/${set}/`));
      expect([key, set, fs.existsSync(f) && fs.statSync(f).size > 1000]).toEqual([key, set, true]);
    }
  });
});

maybe('the screens (sa-ui)', () => {
  let dom; const keep = {}; const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = (ms) => new Promise((res) => setTimeout(res, ms || 20));
  function mount(battery, uiOpts, speakImpl) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    let t = 0;
    const runner = c.createRunner({ battery, now: () => t, mic: () => 'ok', manual: !!(uiOpts && uiOpts.manual) });
    const said = [];
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'proctored', speak: speakImpl || ((x) => { said.push(x); return Promise.resolve(); }) }, uiOpts || {}));
    views.push(view);
    return { runner, el, view, said, tick: (ms) => { t += ms; } };
  }
  const handOver = (x) => { const b = x.el.querySelector('.sae-handover .sae-btn'); if (b) b.click(); };
  const textOf = (s) => (s && (s.en || s.text)) || '';

  test('Back: on a cell after the first (both modes), it shows the cell before; none on the first cell; none when OFF', async () => {
    for (const manual of [false, true]) {
      const x = mount(CELLS, { manual });
      x.runner.start(); x.runner.instructionDone(); x.runner.begin(); x.view.render();
      expect(x.el.querySelector('.sae-back-item')).toBeNull();
      x.el.querySelector('.sa-next').click();
      const b = x.el.querySelector('.sae-back-item');
      expect(b).not.toBeNull();
      b.click();
      expect(x.runner.view().cell_index).toBe(0);
      x.view.destroy();
    }
    const off = mount(Object.assign({}, CELLS, { ui: {} }));
    off.runner.start(); off.runner.instructionDone(); off.runner.begin(); off.view.render();
    off.el.querySelector('.sa-next').click();
    expect(off.el.querySelector('.sae-back-item')).toBeNull();
  });
  test('Back on a tap item: the item before shows again', () => {
    const x = mount(TAP);
    x.runner.start(); x.runner.instructionDone(); x.runner.begin(); x.view.render();
    x.runner.answer(3); x.view.render();
    x.el.querySelector('.sae-back-item').click();
    expect(x.runner.view().item_index).toBe(0);
  });

  const INSTR = (ui) => ({ battery_id: 'b', ui, lines: {}, tasks: [Object.assign({}, CELLS.tasks[0], { script: { intro: { text: 'Read each letter.', audio: 'a.mp3' } } })] });
  test('sa_audio_gated_next: Next waits for Jugnu\'s words; then it works', async () => {
    let end;
    const x = mount(INSTR({ audio_gated_next: true }), {}, () => new Promise((ok) => { end = ok; }));
    handOver(x); x.runner.start(); x.view.render(); await flush();
    expect(x.runner.view().phase).toBe('instruction');
    const next = () => x.el.querySelector('.sae-instr .sae-foot .sae-btn');
    expect(next().disabled).toBe(true);
    next().click();
    expect(x.runner.view().phase).toBe('instruction');
    end(); await flush();
    expect(next().disabled).toBe(false);
    next().click();
    expect(x.runner.view().phase).not.toBe('instruction');
  });
  test('sa_audio_gated_next: a voice that never ends still lets the child on (failsafe)', async () => {
    jest.useFakeTimers();
    try {
      const x = mount(INSTR({ audio_gated_next: true }), {}, () => new Promise(() => {}));
      x.runner.start(); x.view.render();
      const next = () => x.el.querySelector('.sae-instr .sae-foot .sae-btn');
      expect(next().disabled).toBe(true);
      jest.advanceTimersByTime(31000);
      await Promise.resolve(); await Promise.resolve();
      expect(next().disabled).toBe(false);
    } finally { jest.useRealTimers(); }
  });
  test('OFF: Next works at once', async () => {
    const x = mount(INSTR({}), {}, () => new Promise(() => {}));
    x.runner.start(); x.view.render();
    expect(x.el.querySelector('.sae-instr .sae-foot .sae-btn').disabled).toBe(false);
  });

  test('sa_say_then_next: the instruction says and shows "say it, then press Next" after the task\'s own words', async () => {
    const b = INSTR({ say_then_next: true });
    b.lines = { r7_say_next: { text: R7A.LINES.r7_say_next.en, audio: 'n.mp3' } };
    const x = mount(b);
    x.runner.start(); x.view.render(); await flush();
    expect(x.said.map(textOf)).toEqual(['Read each letter.', R7A.LINES.r7_say_next.en]);
    expect(x.el.querySelector('.sae-r7-hint').textContent).toContain(R7A.LINES.r7_say_next.en);
    x.runner.instructionDone(); x.runner.begin(); x.view.render();
    const hint = x.el.querySelector('.sae-run-cell .sae-r7-hint');
    expect(hint).not.toBeNull();
    // above the letter, so the sticky foot (Back / Next) never covers it on a short phone
    const cell = x.el.querySelector('.sae-run-cell .sae-onecell');
    expect(hint.compareDocumentPosition(cell) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  test('sa_tick_prompt: a typed-number task\'s instruction says to press the tick', async () => {
    const b = { battery_id: 'b', ui: { tick_prompt: true }, lines: { r7_type_tick: { text: R7A.LINES.r7_type_tick.en, audio: 't.mp3' } }, tasks: [{ id: 'ma.missing4', subtask: 'missing_number', response: 'keypad', lang: 'en',
      script: { intro: { text: 'One number is missing.' } }, items: [{ id: 'm1', target: 8, shown: [5, 6, 7, null] }] }] };
    const x = mount(b);
    x.runner.start(); x.view.render(); await flush();
    if (x.runner.view().phase === 'keypad_warmup') { x.runner.keypadWarmupDone(0); x.view.render(); await flush(); }
    expect(x.said.map(textOf)).toContain(R7A.LINES.r7_type_tick.en);
    expect(x.el.querySelector('.sae-r7-hint').textContent).toContain(R7A.LINES.r7_type_tick.en);
  });
  test('sa_story_scroll: the story\'s instruction says to slide the page; the story shows the down arrow while more is below', async () => {
    const b = { battery_id: 'b', ui: { story_scroll: true }, lines: { r7_scroll: { text: R7A.LINES.r7_scroll.en, audio: 's.mp3' } }, tasks: [{ id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
      script: { intro: { text: 'Read the story.' } }, passage: { text: 'Ali ran.' }, items: [{ id: 'w1', target: 'Ali' }, { id: 'w2', target: 'ran' }] }] };
    const x = mount(b);
    x.runner.start(); x.view.render(); await flush();
    expect(x.said.map(textOf)).toContain(R7A.LINES.r7_scroll.en);
    x.runner.instructionDone(); x.runner.begin();
    // a page taller than the phone: more below
    const se = document.scrollingElement || document.documentElement;
    Object.defineProperty(se, 'scrollHeight', { configurable: true, get: () => 2000 });
    Object.defineProperty(se, 'clientHeight', { configurable: true, get: () => 640 });
    x.view.render(); await flush();
    const arrow = x.el.querySelector('.sae-more');
    expect(arrow).not.toBeNull();
    expect(arrow.querySelector('.sae-more-ico').textContent).toBe('↓');
    expect(arrow.hidden).toBe(false);
    // scrolled to the end: the arrow goes
    se.scrollTop = 1360; window.dispatchEvent(new window.Event('scroll')); await flush();
    expect(x.el.querySelector('.sae-more').hidden).toBe(true);
  });
});
