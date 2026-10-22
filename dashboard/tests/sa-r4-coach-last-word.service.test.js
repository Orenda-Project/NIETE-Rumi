'use strict';
/**
 * Round 4: in the coach format the COACH marks the last word read, not the child; the word is found from the recording
 * and the coach's tap confirms it. Switch sa_coach_last_word (default OFF; coach mode only):
 *   - after the passage, the screen is the coach's: "Coach: tap the last word the child read"; Jugnu says
 *     "Give the phone back to the coach." (auto) instead of asking the child to tap;
 *   - the page asks lastWordHint(task) for the word heard last in the recording, marks it, and the coach confirms it or
 *     taps another word and confirms that. Nothing is used until Confirm;
 *   - the result keeps last_word_how ('confirm' = the suggestion, 'tap' = the coach's own word) and last_word_suggested.
 * OFF: the child taps the last word, as before.
 */
const core = require('../sa/sa-core');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const words = ['Ali', 'went', 'to', 'the', 'shop.', 'He', 'bought', 'milk.'].map((w, i) => ({ id: 'w' + (i + 1), target: w.replace(/\.$/, ''), line: 1 }));
const PASSAGE = { battery_id: 'b', tasks: [{ id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
  passage: { text: 'Ali went to the shop. He bought milk.' }, items: words }] };

describe('the runner keeps how the last word was marked', () => {
  test('lastWord(i, { how, suggested }) → last_word_how / last_word_suggested on the result', () => {
    let t = 0;
    const r = core.createRunner({ battery: PASSAGE, now: () => t, mic: () => 'ok' });
    r.start(); r.instructionDone(); r.begin(); t += 20000; r.done();
    r.lastWord(5, { how: 'tap', suggested: 6 });
    const res = r.view().result;
    expect(res.last_word_index).toBe(5);
    expect(res.last_word_how).toBe('tap');
    expect(res.last_word_suggested).toBe(6);
  });
  test('the old call lastWord(i) keeps the old result (no new keys)', () => {
    let t = 0;
    const r = core.createRunner({ battery: PASSAGE, now: () => t, mic: () => 'ok' });
    r.start(); r.instructionDone(); r.begin(); t += 20000; r.done(); r.lastWord(3);
    expect(r.view().result.last_word_how).toBeUndefined();
    expect(r.view().result.last_word_suggested).toBeUndefined();
  });
});

maybe('the coach marks the last word (sa-ui)', () => {
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
  function mount(uiOpts, lang) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    let t = 0;
    const runner = c.createRunner({ battery: PASSAGE, now: () => t, mic: () => 'ok' });
    const said = [];
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery: PASSAGE, lang: lang || 'en', mode: 'proctored', speak: (x) => { said.push(x); return Promise.resolve(); } }, uiOpts));
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin(); t += 20000; runner.done();
    return { runner, el, view, said };
  }
  const wordBtn = (el, i) => el.querySelector('.sae-word[data-i="' + i + '"]');
  const confirmBtn = (el) => el.querySelector('.sa-lw-confirm');

  test('ON: the coach screen; the suggestion is marked; Confirm uses it (how: confirm)', async () => {
    let ask = null;
    const x = mount({ coach_last_word: true, lastWordHint: (task) => { ask = task.id; return Promise.resolve(6); } });
    x.view.render(); await flush();
    expect(ask).toBe('en.story_w3');
    expect(x.el.querySelector('.sae-lastword.is-coach')).not.toBeNull();
    expect(x.el.querySelector('.sae-h1').textContent).toBe('Coach: tap the last word the child read');
    expect(wordBtn(x.el, 6).classList.contains('is-picked')).toBe(true);
    expect(x.runner.view().phase).toBe('last_word'); // nothing used before Confirm
    confirmBtn(x.el).click(); await flush();
    const res = x.runner.view().result;
    expect(res.last_word_index).toBe(6);
    expect(res.last_word_how).toBe('confirm');
    expect(res.last_word_suggested).toBe(6);
  });

  test('ON: the coach taps another word, then Confirm uses the coach\'s word (how: tap)', async () => {
    const x = mount({ coach_last_word: true, lastWordHint: () => Promise.resolve(6) });
    x.view.render(); await flush();
    wordBtn(x.el, 4).click(); await flush();
    expect(x.runner.view().phase).toBe('last_word');
    expect(wordBtn(x.el, 4).classList.contains('is-picked')).toBe(true);
    expect(wordBtn(x.el, 6).classList.contains('is-picked')).toBe(false);
    confirmBtn(x.el).click(); await flush();
    expect(x.runner.view().result.last_word_index).toBe(4);
    expect(x.runner.view().result.last_word_how).toBe('tap');
    expect(x.runner.view().result.last_word_suggested).toBe(6);
  });

  test('ON, no suggestion (offline): Confirm waits for the coach\'s tap', async () => {
    const x = mount({ coach_last_word: true, lastWordHint: () => Promise.resolve(null) });
    x.view.render(); await flush();
    expect(confirmBtn(x.el).disabled).toBe(true);
    wordBtn(x.el, 2).click(); await flush();
    expect(confirmBtn(x.el).disabled).toBe(false);
    confirmBtn(x.el).click(); await flush();
    expect(x.runner.view().result.last_word_index).toBe(2);
    expect(x.runner.view().result.last_word_suggested).toBeNull();
  });

  test('ON: Jugnu tells the child to give the phone to the coach (not to tap)', async () => {
    const x = mount({ coach_last_word: true, lastWordHint: () => Promise.resolve(null) });
    x.view.render(); await flush();
    const lines = x.said.map((s) => (s && (s.en || s.text)) || '');
    expect(lines).toContain('Give the phone back to the coach.');
    expect(lines).not.toContain('Tap the last word you read');
  });

  test('ON, Urdu: the coach line in Nastaliq', async () => {
    const x = mount({ coach_last_word: true, lastWordHint: () => Promise.resolve(null) }, 'ur');
    x.view.render(); await flush();
    expect(x.el.querySelector('.sae-h1').textContent).toBe('کوچ: بچے کا پڑھا ہوا آخری لفظ دبائیں');
  });

  test('OFF: a tap is the last word at once (the child taps)', async () => {
    const x = mount({});
    x.view.render(); await flush();
    expect(confirmBtn(x.el)).toBeNull();
    wordBtn(x.el, 3).click(); await flush();
    expect(x.runner.view().result.last_word_index).toBe(3);
  });
});

describe('the engine asks the sink for the hint (sink.lastWordHint) and the switch reaches the battery', () => {
  test('sink-coach posts taskId to /last-word-hint', async () => {
    const calls = [];
    const sink = require('../sa/sink-coach').create({ fetch: async (u, init) => { calls.push([u, JSON.parse(init.body)]); return { ok: true, json: async () => ({ success: true, index: 7 }) }; }, localStorage: null });
    const got = await sink.lastWordHint({ session_id: 's1', task_id: 'en.story_w3' });
    expect(calls[0][0]).toBe('/api/portal/leader/child-test/sa/session/s1/last-word-hint');
    expect(calls[0][1]).toEqual({ taskId: 'en.story_w3' });
    expect(got).toEqual({ success: true, index: 7 });
  });
  test('named sa_coach_last_word; ON adds ui.coach_last_word; OFF no ui key', () => {
    const b = { battery_id: 'b', tasks: [{ id: 't' }] };
    expect(SWITCHES.coachLastWord).toBe('sa_coach_last_word');
    expect(applySwitches(b, { coachLastWord: true, rdfW3Forms: true }).ui).toEqual({ coach_last_word: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
});

describe('the engine: lastWordHint asks the sink until the clip is up', () => {
  const storeMod = require('../sa/sa-store');
  const { start } = require('../sa/sa-engine');
  async function boot(ui, answers) {
    const store = await storeMod.open({ idb: null });
    let hooks = null; const asked = [];
    const sink = { putBatch: async (b) => ({ ok: true, acked_to: b.seq_to }), lastWordHint: async (a) => { asked.push(a); return answers.shift(); } };
    await start({ mount: {}, battery: Object.assign({}, PASSAGE, { ui }), mode: 'proctored', lang: 'en', sink, session_id: 's-lw', audio_check: false, warmup: false }, {
      core, store: { open: async () => store }, ui: { mount: (el, o) => { hooks = o; return {}; } },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: null, micState: () => 'ok', hintRetryMs: 5,
    });
    return { hooks, asked };
  }
  test('ON: pending, pending, then the index', async () => {
    const x = await boot({ coach_last_word: true }, [{ success: true, pending: true }, { success: true, pending: true }, { success: true, index: 6 }]);
    expect(x.hooks.coach_last_word).toBe(true);
    await expect(x.hooks.lastWordHint(PASSAGE.tasks[0])).resolves.toBe(6);
    expect(x.asked).toHaveLength(3);
    expect(x.asked[0]).toEqual({ session_id: 's-lw', task_id: 'en.story_w3' });
  });
  test('ON: the server has no word (index null) → null; OFF → null without asking', async () => {
    const a = await boot({ coach_last_word: true }, [{ success: true, index: null }]);
    await expect(a.hooks.lastWordHint(PASSAGE.tasks[0])).resolves.toBeNull();
    const b = await boot({}, [{ success: true, index: 3 }]);
    await expect(b.hooks.lastWordHint(PASSAGE.tasks[0])).resolves.toBeNull();
    expect(b.asked).toHaveLength(0);
  });
});
