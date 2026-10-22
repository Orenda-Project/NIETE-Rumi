'use strict';
/**
 * A task that records, on a phone with no working microphone, ends as mic_unavailable (dashboard/sa/sa-ui.js task_end):
 * the screen shows one line and Jugnu says it ("No microphone, so we skip this part"), held 3 s, then the next task.
 * Never the "good effort" line, never a silent jump. On a real DOM where jsdom resolves; skipped otherwise.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui mic_unavailable skip line on a DOM', () => {
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
  afterEach(() => { views.splice(0).forEach((v) => v.destroy()); jest.useRealTimers(); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  function skipped(lang, lines) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    const after = { en: 'Good effort, let us go on.', ur: 'اچھی کوشش' };
    const battery = {
      battery_id: 'b',
      lines: lines || {},
      tasks: [
        { id: 'en.story', mode: 'record', lang: 'en', script: { after }, passage: { text: 'A cat sat.' }, items: [{ id: 'w1', text: 'A' }] },
        { id: 'ma.number_id', mode: 'tap', script: { after }, items: [{ id: 'i', target: '7', options: ['7', '9'] }] },
      ],
    };
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'no' });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'game', speak: (t) => { said.push(t); return Promise.resolve(); } });
    views.push(view);
    runner.start();
    view.render();
    return { el, said, runner };
  }

  test('EN: the line is shown and said once, no "after" line, and the next task follows after 3 s', async () => {
    jest.useFakeTimers();
    const { el, said, runner } = skipped('en');
    await jest.advanceTimersByTimeAsync(50);
    expect(runner.view().phase).toBe('task_end');
    expect(runner.view().result.stop_reason).toBe('mic_unavailable');
    expect(el.querySelector('.sae-micskip').textContent).toBe('No microphone, so we skip this part');
    const skipLines = said.filter((t) => t && t.en === 'No microphone, so we skip this part');
    expect(skipLines).toHaveLength(1);
    expect(skipLines[0].ur).toBe('مائیک نہیں ہے، اس لیے یہ حصہ چھوڑ رہے ہیں');
    expect(said.some((t) => t && t.en === 'Good effort, let us go on.')).toBe(false);
    await jest.advanceTimersByTimeAsync(2400);
    expect(runner.view().phase).toBe('task_end');
    await jest.advanceTimersByTimeAsync(700);
    expect(runner.view().phase).not.toBe('task_end');
    expect(runner.view().task.id).toBe('ma.number_id');
  });

  test('UR: the line in Urdu, and the battery\'s own recorded line wins when it has one', async () => {
    const own = { en: 'No microphone, so we skip this part', ur: 'مائیک نہیں ہے، اس لیے یہ حصہ چھوڑ رہے ہیں', audio: { en: 'sa/v2/en/x.mp3', ur: 'sa/v2/ur/y.mp3' } };
    jest.useFakeTimers();
    const { el, said } = skipped('ur', { mic_skip_task: own });
    await jest.advanceTimersByTimeAsync(50);
    expect(el.querySelector('.sae-micskip').textContent).toBe('مائیک نہیں ہے، اس لیے یہ حصہ چھوڑ رہے ہیں');
    expect(said.filter((t) => t === own)).toHaveLength(1);
  });
});
