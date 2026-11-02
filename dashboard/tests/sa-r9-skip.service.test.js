'use strict';
/**
 * Round 9 item 3 (battery.ui.r9_skip_instructions): coach-led RDF (RDF manual) only, the coach can skip a part's
 * instructions — its instruction screen and its practice — never the part itself. The skip lands on the part's own
 * Ready screen: Go still starts the clock and the first item is still asked. One `skip_instructions` event
 * { by: 'coach', from: 'instruction' | 'practice', practice_left } on the part's task_id.
 * OFF (switch absent), RDF auto, and the session gates (mic check, oral practice, keypad warm-up): as today.
 * The runner part runs everywhere; the screens part mounts the real UI on a jsdom page with a real runner.
 */
const core = require('../sa/sa-core');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const ON = { r9_skip_instructions: true };
const tapItems = (n, pre) => Array.from({ length: n }, (_, i) => ({ id: `${pre}${i + 1}`, target: 'a', options: ['a', 'b'] }));
const TAP = (id, n, practice) => ({ id, mode: 'tap', title: 'Letters', coach_text: 'Tap the letter you hear.',
  practice: practice ? tapItems(practice, 'p') : [], items: tapItems(n, 'i') });
const battery = (ui, tasks) => Object.assign({ battery_id: 'b', tasks: tasks || [TAP('ur.letters', 3, 2), TAP('ur.words', 2, 0)] }, ui ? { ui } : {});

function run(b, o = {}) {
  let t = 0;
  const events = [];
  const r = core.createRunner({ battery: b, now: () => t, mic: () => 'ok', onEvent: (e) => events.push(e), ...o });
  r.start();
  return { r, events, of: (type) => events.filter((e) => e.type === type), tick: (ms) => { t += ms; return r.tick(); } };
}

describe('runner: skipInstructions (RDF manual, battery.ui.r9_skip_instructions)', () => {
  test('ON, from the instruction: lands on Ready (never past it); one event; the part then runs whole', () => {
    const x = run(battery(ON), { manual: true });
    expect(x.r.view().phase).toBe('instruction');
    expect(x.r.skipInstructions('coach')).toBe(true);
    expect(x.r.view().phase).toBe('ready');
    expect(x.r.view().task.id).toBe('ur.letters');
    expect(x.of('skip_instructions')).toEqual([expect.objectContaining({ type: 'skip_instructions', task_id: 'ur.letters',
      value: { by: 'coach', from: 'instruction', practice_left: 2 } })]);
    // a second press on Ready does nothing (no second event, still Ready)
    expect(x.r.skipInstructions('coach')).toBe(false);
    expect(x.of('skip_instructions')).toHaveLength(1);
    expect(x.of('practice_answer')).toHaveLength(0);
    x.r.begin();
    expect(x.r.view().phase).toBe('running');
    expect(x.r.view().item.id).toBe('i1');
    x.r.answer('a'); x.r.answer('b'); x.r.answer('a');
    const res = x.r.results().find((r) => r.task_id === 'ur.letters');
    expect(res).toMatchObject({ stop_reason: 'complete', attempted: 3, correct: 2 });
  });
  test('ON, from the practice (one practice item answered): practice_left counts what was not done', () => {
    const x = run(battery(ON), { manual: true });
    x.r.instructionDone();
    x.r.practiceAnswer('a');
    expect(x.r.view().phase).toBe('practice');
    expect(x.r.skipInstructions('coach')).toBe(true);
    expect(x.r.view().phase).toBe('ready');
    expect(x.of('skip_instructions')[0].value).toEqual({ by: 'coach', from: 'practice', practice_left: 1 });
  });
  test('ON: never while the part runs, nor on its end screen (the part itself is never skipped)', () => {
    const x = run(battery(ON), { manual: true });
    x.r.instructionDone(); x.r.practiceAnswer('a'); x.r.practiceAnswer('a');
    x.r.begin();
    expect(x.r.skipInstructions('coach')).toBe(false);
    expect(x.r.view().phase).toBe('running');
    x.r.answer('a'); x.r.answer('a'); x.r.answer('a');
    expect(x.r.view().phase).toBe('task_end');
    expect(x.r.skipInstructions('coach')).toBe(false);
    expect(x.of('skip_instructions')).toHaveLength(0);
  });
  test('ON: a session gate (the oral practice) is not an instruction', () => {
    const oral = { id: 'ur.listen', mode: 'oral', items: [{ id: 'q1', prompt: { en: 'q' } }] };
    const x = run(battery(ON, [oral]), { manual: true, oral_practice: true });
    expect(x.r.view().phase).toBe('oral_practice');
    expect(x.r.skipInstructions('coach')).toBe(false);
    expect(x.r.view().phase).toBe('oral_practice');
  });
  test('OFF (no switch), or RDF auto with the switch: nothing happens, no event', () => {
    for (const [b, o] of [[battery(undefined), { manual: true }], [battery({ r9_skip_instructions: 'yes' }), { manual: true }], [battery(ON), {}]]) {
      const x = run(b, o);
      expect(x.r.skipInstructions('coach')).toBe(false);
      expect(x.r.view().phase).toBe('instruction');
      expect(x.of('skip_instructions')).toHaveLength(0);
    }
  });
});

maybe('sa-ui round 9 item 3: Skip instructions on the coach-led screens', () => {
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
  afterEach(() => {
    views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } });
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });

  function mount(b, o) {
    o = o || {};
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const events = [];
    const manual = o.manual !== false;
    const runner = c.createRunner({ battery: b, onEvent: (e) => events.push(e), mic: () => 'ok', manual });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery: b, lang: o.lang || 'en', mode: 'proctored', manual,
      speak: () => Promise.resolve() });
    views.push(view);
    runner.start();
    view.render();
    return { runner, el, view, events, of: (type) => events.filter((e) => e.type === type) };
  }
  const skipBtn = (el) => el.querySelector('.sae-r9-skip');
  const btnText = (el, rx) => [...el.querySelectorAll('button')].find((b) => rx.test(b.textContent));

  test('ON, the coach brief: Skip instructions beside the hand-over → the Ready screen; Go asks the first item', () => {
    const m = mount(battery(ON));
    expect(m.el.querySelector('.sae-coach-brief')).not.toBeNull();
    expect(m.el.classList.contains('is-r9-skip')).toBe(true);
    const b = skipBtn(m.el);
    expect(b).not.toBeNull();
    expect(b.textContent).toBe('Skip instructions');
    expect(b.classList.contains('is-coach')).toBe(true);
    // in the brief's foot, after the hand-over button (which stays first and primary)
    const foot = m.el.querySelector('.sae-coach-brief .sae-foot');
    expect(foot.contains(b)).toBe(true);
    expect(foot.firstElementChild.textContent).toBe('Give the phone to the child');
    b.click();
    expect(m.runner.view().phase).toBe('ready');
    expect(m.el.getAttribute('data-phase')).toBe('ready');
    expect(m.of('skip_instructions')).toEqual([expect.objectContaining({ task_id: 'ur.letters', value: { by: 'coach', from: 'instruction', practice_left: 2 } })]);
    expect(skipBtn(m.el)).toBeNull(); // Ready is the part's own screen: no skip there
    btnText(m.el, /^Go/).click();
    expect(m.runner.view().phase).toBe('running');
    expect(m.runner.view().item.id).toBe('i1');
    expect(m.el.querySelectorAll('.sae-opt').length).toBe(2);
    expect(m.of('skip_instructions')).toHaveLength(1);
  });
  test('ON, a coach-led practice screen: the skip is there (coach-styled), never over the answers', () => {
    const m = mount(battery(ON), { lang: 'ur' });
    m.runner.instructionDone(); m.view.render();
    expect(m.el.getAttribute('data-phase')).toBe('practice');
    const b = skipBtn(m.el);
    expect(b).not.toBeNull();
    expect(b.textContent).toBe('ہدایات چھوڑیں');
    expect(Array.from(b.textContent).length).toBeLessThanOrEqual(20);
    expect(b.closest('.sae-opts')).toBeNull();
    b.click();
    expect(m.runner.view().phase).toBe('ready');
    expect(m.of('skip_instructions')[0].value).toEqual({ by: 'coach', from: 'practice', practice_left: 2 });
    expect(m.of('practice_answer')).toHaveLength(0);
  });
  test('ON, the coach menu (the hold corner) offers it on the instruction and practice, not once the part runs', () => {
    jest.useFakeTimers();
    try {
      const m = mount(battery(ON));
      const hold = m.el.querySelector('.sae-hold');
      hold.dispatchEvent(new dom.window.Event('pointerdown'));
      jest.advanceTimersByTime(5000);
      const menu = m.el.querySelector('.sae-coach-menu');
      expect(menu).not.toBeNull();
      const b = menu.querySelector('.sae-r9-skip');
      expect(b).not.toBeNull();
      b.click();
      expect(m.runner.view().phase).toBe('ready');
      expect(m.el.querySelector('.sae-coach-menu')).toBeNull();
      m.runner.begin(); m.view.render();
      m.el.querySelector('.sae-hold').dispatchEvent(new dom.window.Event('pointerdown'));
      jest.advanceTimersByTime(5000);
      expect(m.el.querySelector('.sae-coach-menu')).not.toBeNull();
      expect(m.el.querySelector('.sae-coach-menu .sae-r9-skip')).toBeNull();
    } finally { jest.useRealTimers(); }
  });
  test('OFF (no switch): the coach brief and the practice are today\'s (no skip, no class, one foot button)', () => {
    const m = mount(battery(undefined));
    expect(skipBtn(m.el)).toBeNull();
    expect(m.el.classList.contains('is-r9-skip')).toBe(false);
    expect(m.el.querySelector('.sae-coach-brief .sae-foot').children.length).toBe(1);
    m.runner.instructionDone(); m.view.render();
    expect(skipBtn(m.el)).toBeNull();
    expect(m.of('skip_instructions')).toHaveLength(0);
  });
  test('RDF auto with the switch ON: never shown (instruction or practice)', () => {
    const m = mount(battery(ON), { manual: false });
    expect(m.el.getAttribute('data-phase')).toBe('instruction');
    expect(skipBtn(m.el)).toBeNull();
    expect(m.el.classList.contains('is-r9-skip')).toBe(false);
    m.runner.instructionDone(); m.view.render();
    expect(skipBtn(m.el)).toBeNull();
  });
});
