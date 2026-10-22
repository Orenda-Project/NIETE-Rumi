'use strict';
/**
 * Round 4: spoken answers were cut (one clip per question, opened after Jugnu finished asking and closed the moment the
 * screen moved on). Switch sa_section_recording (default OFF): an oral task (comprehension, listening, spoken maths) is
 * ONE recording from Begin to the task's end, id <task_id>; its result carries rec_section: true and rec_marks
 * [{ item_id, ask_ms, answer_ms, end_ms }] (ms from the recording's start) so the scorer can find each answer.
 * OFF: one clip per question, as before.
 */
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const ORAL = { battery_id: 'b', tasks: [{ id: 'en.story_comp_w3', subtask: 'reading_comprehension', lang: 'en', question_timeout_s: 30,
  items: [{ id: 'q1', prompt: { en: 'Who?' } }, { id: 'q2', prompt: { en: 'Where?' } }, { id: 'q3', prompt: { en: 'Why?' } }] }] };

describe('the runner: rec_marks for a section recording', () => {
  const core = require('../sa/sa-core');
  test('ON: marks per question from the recording start; rec_section true', () => {
    const c = clock();
    const r = core.createRunner({ battery: ORAL, now: c.now, mic: () => 'ok', section_recording: true });
    r.start(); r.instructionDone(); r.begin();
    c.add(200); r.log('record_start', { task_id: 'en.story_comp_w3' }); // the recorder opens 200 ms after Begin
    c.add(1800); r.promptDone(); c.add(4000); r.answer('spoken'); // q1: asked at 0 (before the recording), answer window 2000
    c.add(1500); r.promptDone(); c.add(3000); r.answer('spoken'); // q2: shown at 6000
    c.add(1000); r.promptDone(); c.add(2000); r.answer('spoken');
    const res = r.view().result;
    expect(res.rec_section).toBe(true);
    expect(res.rec_marks).toEqual([
      { item_id: 'q1', ask_ms: 0, answer_ms: 1800, end_ms: 5800 },
      { item_id: 'q2', ask_ms: 5800, answer_ms: 7300, end_ms: 10300 },
      { item_id: 'q3', ask_ms: 10300, answer_ms: 11300, end_ms: 13300 },
    ]);
  });
  test('OFF: no rec_marks, no rec_section', () => {
    const c = clock();
    const r = core.createRunner({ battery: ORAL, now: c.now, mic: () => 'ok' });
    r.start(); r.instructionDone(); r.begin();
    r.log('record_start', { task_id: 'en.story_comp_w3' });
    for (let i = 0; i < 3; i++) { c.add(1000); r.answer('spoken'); }
    expect(r.view().result.rec_marks).toBeUndefined();
    expect(r.view().result.rec_section).toBeUndefined();
  });
});

maybe('the page: one recording per oral task (sa-ui)', () => {
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
  function mount(uiOpts, runnerOpts) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const c = clock();
    const runner = core.createRunner(Object.assign({ battery: ORAL, now: c.now, mic: () => 'ok', oral_practice: false }, runnerOpts || {}));
    const calls = [];
    const view = ui.mount(document.getElementById('m'), Object.assign({ runner, battery: ORAL, lang: 'en', mode: 'proctored', speak: () => Promise.resolve(),
      onRecordStart: (t, it) => calls.push('start ' + t.id + (it ? '/' + it.id : '')), onRecordStop: (t, it) => calls.push('stop ' + t.id + (it ? '/' + it.id : '')) }, uiOpts));
    views.push(view);
    return { runner, view, calls };
  }
  async function walk(x) {
    x.runner.start(); x.runner.instructionDone(); x.runner.begin(); x.view.render(); await flush();
    for (let i = 0; i < 3; i++) { x.runner.answer('spoken'); x.view.render(); await flush(); }
    x.runner.next(); x.view.render(); await flush();
  }
  test('ON: the recorder opens once at Begin (no item) and closes once at the end', async () => {
    const x = mount({ section_recording: true }, { section_recording: true });
    await walk(x);
    expect(x.calls).toEqual(['start en.story_comp_w3', 'stop en.story_comp_w3']);
  });
  test('OFF: one clip per question', async () => {
    const x = mount({});
    await walk(x);
    expect(x.calls.filter((s) => s.startsWith('start'))).toEqual(['start en.story_comp_w3/q1', 'start en.story_comp_w3/q2', 'start en.story_comp_w3/q3']);
  });
});

describe('the switch reaches the battery as ui.section_recording', () => {
  test('named sa_section_recording; ON adds ui.section_recording; OFF no ui key', () => {
    const b = { battery_id: 'b', tasks: [{ id: 't' }] };
    expect(SWITCHES.sectionRecording).toBe('sa_section_recording');
    expect(applySwitches(b, { sectionRecording: true, rdfW3Forms: true }).ui).toEqual({ section_recording: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
});
