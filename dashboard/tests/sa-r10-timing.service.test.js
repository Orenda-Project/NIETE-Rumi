'use strict';
/**
 * Round 10, timing 1 (battery.ui.r10_practice_next): when a practice section ends, the Ready screen's Next ("Go") is
 * usable at once, with no fixed wait added on top of Jugnu's own words.
 *   - a tap practice (which is bigger, the missing number): today the last answer holds the screen for at least
 *     FEEDBACK_MS (1.2 s) even when Jugnu's feedback is shorter or silent (coach-led). ON: the screen moves on the
 *     moment the feedback has been said (at once when Jugnu is silent);
 *   - a spoken practice (letters, words, numbers, sums one at a time): no fixed wait today or ON; under audio_gated_next
 *     Go waits for Jugnu's Ready lines only, and opens the moment they end;
 *   - a double tap never moves two screens: a tap on Go within the double-tap window of the tap that ended the
 *     practice is the same double tap, and is ignored (Go is drawn enabled all the same);
 *   - OFF: today's waits, unchanged.
 * Mounts the real UI on a jsdom page with a real runner and the real RDF practice tasks as served (prod switches on).
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');
const page = require('../sa/sa-page');

/** The RDF form as served with every switch on as on prod (the other round 10 items off), r10_practice_next on or off. */
function served(f, block, on) {
  const sw = {};
  for (const k of Object.keys(SWITCHES)) sw[k] = !['appAsks', 'r10HintOnce', 'r10UrduFit', 'r10NumberFit'].includes(k);
  sw.r10PracticeNext = on;
  const full = applySwitches(JSON.parse(fs.readFileSync(path.join(FORMS, f), 'utf8')), sw);
  return page.pick(full, block);
}
/** One practice task of the served form, on its own (straight to its practice). */
function alone(f, block, id, on) {
  const b = served(f, block, on);
  const t = JSON.parse(JSON.stringify(b.tasks.find((x) => x.id === id)));
  delete t.depends_on;
  return Object.assign({}, b, { tasks: [t] });
}

const GAP = 300; // the double-tap window (sa-ui DOUBLE_TAP_MS)

maybe('sa-ui round 10 timing 1: Next after a practice', () => {
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
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } });
    jest.useRealTimers();
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });

  const textOf = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text != null ? x.text : (x.en || x.ur || ''));
  /**
   * o.manual: RDF manual (the coach leads, Jugnu is silent on these screens). o.ms(text) → how long Jugnu takes to say
   * a line (0 = at once), so a line's end is a timer under the fake clock.
   */
  function mount(b, o) {
    o = o || {};
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const events = [];
    const said = [];
    const runner = core.createRunner({ battery: b, onEvent: (e) => events.push(e), mic: () => 'ok', now: () => 1000,
      manual: !!o.manual, one_at_a_time: true, cell_next_only: true, section_recording: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, {
      runner, battery: b, lang: o.lang || 'ur', mode: 'proctored', manual: !!o.manual,
      speak: (t, a) => {
        said.push(textOf(t));
        const ms = o.ms ? o.ms(textOf(t)) : 0;
        return ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
      },
    });
    views.push(view);
    return { runner, el, view, events, said };
  }
  const shown = (m) => m.el.getAttribute('data-phase');
  const go = (m) => m.el.querySelector('.sae-ready .sae-go');
  const usable = (b) => !!b && !b.disabled && !b.classList.contains('is-wait');
  /** To the task's last practice screen (the ones before answered straight on), Jugnu done speaking. */
  async function toLastPractice(m) {
    m.runner.start(); m.runner.instructionDone(); m.view.render();
    await jest.advanceTimersByTimeAsync(20000);
    const t = m.runner.view().task;
    while (t.practice.indexOf(m.runner.view().practice) < t.practice.length - 1) {
      m.runner.practiceAnswer(m.runner.view().practice.target); m.view.render();
      await jest.advanceTimersByTimeAsync(20000);
    }
    expect(m.runner.view().phase).toBe('practice');
    return m.runner.view().practice;
  }
  function tapRight(m, p) {
    const b = m.el.querySelector('.sae-practice .sae-opt[data-value="' + String(p.target) + '"]');
    expect(b).not.toBeNull();
    b.click();
  }
  const practiceNext = (m) => m.el.querySelector('.sae-practice .sa-next');

  const TAP = [['ma.discrimination2', 'sa.coach.G3.A.ur.json', 'ur'], ['ma.missing4', 'sa.coach.G3.A.ur.json', 'ur'],
    ['ma.discrimination2', 'sa.coach.G3.A.en.json', 'en'], ['ma.missing4', 'sa.coach.G3.A.en.json', 'en']];
  const SPOKEN = [['ur.letter_names5', 'sa.coach.G3.A.ur.json', 'ur'], ['ur.words4', 'sa.coach.G3.A.ur.json', 'ur'],
    ['en.words4', 'sa.coach.G3.A.en.json', 'en'], ['ma.number_id8', 'sa.coach.G3.A.ur.json', 'ur'], ['ma.add2i', 'sa.coach.G3.A.en.json', 'en']];

  // ---------- a tap practice: the 1.2 s hold ----------
  describe('tap practice, RDF manual (Jugnu silent)', () => {
    test.each(TAP)('OFF (%s, %s): the last answer holds the screen 1200 ms before Ready and its Next (today)', async (id, f, lang) => {
      const m = mount(alone(f, 'rdf_manual', id, false), { manual: true, lang });
      const p = await toLastPractice(m);
      tapRight(m, p);
      await jest.advanceTimersByTimeAsync(0);
      expect(shown(m)).toBe('practice');
      expect(go(m)).toBeNull();
      await jest.advanceTimersByTimeAsync(1199);
      expect(shown(m)).toBe('practice');
      await jest.advanceTimersByTimeAsync(1);
      expect(shown(m)).toBe('ready');
      expect(usable(go(m))).toBe(true);
    });
    test.each(TAP)('ON (%s, %s): Ready and its Next at 0 ms; a deliberate tap is accepted', async (id, f, lang) => {
      const m = mount(alone(f, 'rdf_manual', id, true), { manual: true, lang });
      const p = await toLastPractice(m);
      tapRight(m, p);
      await jest.advanceTimersByTimeAsync(0);
      expect(shown(m)).toBe('ready');
      expect(usable(go(m))).toBe(true);
      await jest.advanceTimersByTimeAsync(GAP);
      go(m).click();
      expect(m.runner.view().phase).toBe('running');
    });
    test.each(TAP)('ON (%s, %s): a double tap (the tile twice, then Go) moves one screen, never two', async (id, f, lang) => {
      const m = mount(alone(f, 'rdf_manual', id, true), { manual: true, lang });
      const p = await toLastPractice(m);
      const tile = m.el.querySelector('.sae-practice .sae-opt[data-value="' + String(p.target) + '"]');
      tile.click(); tile.click(); // back to back, the same tick
      await jest.advanceTimersByTimeAsync(0);
      expect(m.events.filter((e) => e.type === 'practice_answer')).toHaveLength(m.runner.view().task.practice.length);
      expect(go(m)).not.toBeNull();
      go(m).click(); // the double tap's second touch landing on the new screen
      await jest.advanceTimersByTimeAsync(150);
      go(m).click();
      expect(m.runner.view().phase).toBe('ready');
      expect(shown(m)).toBe('ready');
    });
  });

  describe('tap practice, RDF auto (Jugnu says the feedback)', () => {
    const FB = 500; // a feedback line shorter than the old 1.2 s floor
    test.each(TAP)('OFF (%s, %s): a 0.5 s feedback line still holds the screen 1200 ms (today)', async (id, f, lang) => {
      const m = mount(alone(f, 'rdf_auto', id, false), { lang, ms: (s) => (/^(That is right|بالکل ٹھیک|The |بڑا|یہاں)/.test(s) ? FB : 0) });
      const p = await toLastPractice(m);
      tapRight(m, p);
      await jest.advanceTimersByTimeAsync(FB);
      expect(shown(m)).toBe('practice');
      await jest.advanceTimersByTimeAsync(1200 - FB);
      expect(shown(m)).toBe('ready');
      expect(usable(go(m))).toBe(true);
    });
    test.each(TAP)('ON (%s, %s): Ready the moment the feedback ends; its Next usable and a tap accepted then (0 ms added)', async (id, f, lang) => {
      const m = mount(alone(f, 'rdf_auto', id, true), { lang, ms: (s) => (/^(That is right|بالکل ٹھیک|The |بڑا|یہاں)/.test(s) ? FB : 0) });
      const p = await toLastPractice(m);
      tapRight(m, p);
      await jest.advanceTimersByTimeAsync(FB - 1);
      expect(shown(m)).toBe('practice');
      await jest.advanceTimersByTimeAsync(1);
      expect(shown(m)).toBe('ready');
      expect(usable(go(m))).toBe(true);
      go(m).click();
      expect(m.runner.view().phase).toBe('running');
    });
  });

  // ---------- a spoken practice: no fixed wait; Jugnu's Ready lines under audio_gated_next ----------
  describe('spoken practice', () => {
    test.each(SPOKEN)('ON and OFF (%s, %s), RDF auto, instant speech: Next usable at 0 ms', async (id, f, lang) => {
      for (const on of [false, true]) {
        document.getElementById('m').innerHTML = '';
        const m = mount(alone(f, 'rdf_auto', id, on), { lang });
        await toLastPractice(m);
        practiceNext(m).click();
        await jest.advanceTimersByTimeAsync(0);
        expect(shown(m)).toBe('ready');
        expect(usable(go(m))).toBe(true);
        views.splice(0).forEach((v) => v.destroy());
      }
    });
    test.each(SPOKEN)('ON (%s, %s), RDF auto: Go waits only while Jugnu says the Ready lines, and opens the moment they end', async (id, f, lang) => {
      const b = alone(f, 'rdf_auto', id, true);
      const s = b.tasks[0].script;
      const ready = [textOf(s.test_intro), textOf(s.begin)];
      const m = mount(b, { lang, ms: (x) => (ready.includes(x) ? 2000 : 0) });
      await toLastPractice(m);
      practiceNext(m).click();
      await jest.advanceTimersByTimeAsync(0);
      expect(shown(m)).toBe('ready');
      expect(go(m).disabled).toBe(true); // Jugnu is speaking (audio_gated_next)
      await jest.advanceTimersByTimeAsync(3999);
      expect(go(m).disabled).toBe(true);
      await jest.advanceTimersByTimeAsync(1);
      expect(usable(go(m))).toBe(true);
      go(m).click();
      expect(m.runner.view().phase).toBe('running');
    });
    test.each(SPOKEN)('ON (%s, %s), RDF manual: a double tap (Next twice, then Go) moves one screen; Go works after the window', async (id, f, lang) => {
      const m = mount(alone(f, 'rdf_manual', id, true), { manual: true, lang });
      await toLastPractice(m);
      const n = practiceNext(m);
      n.click(); n.click(); // back to back, the same tick
      await jest.advanceTimersByTimeAsync(0);
      expect(m.events.filter((e) => e.type === 'practice_answer').length).toBe(m.runner.view().task.practice.length);
      expect(shown(m)).toBe('ready');
      expect(usable(go(m))).toBe(true);
      go(m).click(); // the double tap's second touch, landing on Go
      expect(m.runner.view().phase).toBe('ready');
      await jest.advanceTimersByTimeAsync(GAP - 1);
      go(m).click();
      expect(m.runner.view().phase).toBe('ready');
      await jest.advanceTimersByTimeAsync(1);
      go(m).click();
      expect(m.runner.view().phase).toBe('running');
    });
    test('OFF, RDF manual: Go takes the tap at once, so a double tap starts the part (today)', async () => {
      const m = mount(alone('sa.coach.G3.A.ur.json', 'rdf_manual', 'ur.words4', false), { manual: true });
      await toLastPractice(m);
      practiceNext(m).click();
      await jest.advanceTimersByTimeAsync(0);
      go(m).click();
      expect(m.runner.view().phase).toBe('running');
    });
  });
});
