'use strict';
/**
 * Round 28, a clip that starts and then stalls mid-play (opts.clip_only: the letter-sound picker and the spoken MCQ).
 * A clip_only line that fired `playing` must reach `ended`. When its currentTime makes no progress for the no-progress
 * window (5 s; `waiting`/`stalled` mark it, `timeupdate` clears it) the voice tries the clip once more from 0; a second
 * stall, or the 60 s never-ended guard firing without `ended`, rejects the line the way a clip that never loaded does
 * (clip_unavailable). On the item's FIRST play that makes the item unavailable (not asked, not presented, not wrong);
 * on a child's replay it only ends that replay (the item stays open and a tap still scores). A tap during a
 * first-play stall is dropped. A line without clip_only keeps the 60 s resolve.
 *
 * Voice rows: the real sa-voice.js, a stub Audio driven by the test, fake timers at the production defaults.
 * UI rows (jsdom, the portal's copy): the real sa-voice.js under sa-ui.js with a short window, real timers.
 */
const path = require('path');

const VOICE = path.join(__dirname, '..', 'sa', 'sa-voice.js');

/** A stub <audio>: on* handlers and listeners; script(a, k) drives the k-th element made for the same src. */
function stubAudio(script) {
  const els = [];
  class FakeAudio {
    constructor(src) {
      this.src = src || ''; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 1.5; this.ls = {};
      els.push(this);
    }
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }
    removeEventListener(t, f) { this.ls[t] = (this.ls[t] || []).filter((x) => x !== f); }
    emit(t) {
      const h = this['on' + t];
      if (h) h.call(this, { type: t });
      (this.ls[t] || []).slice().forEach((f) => f.call(this, { type: t }));
    }
    play() {
      this.paused = false;
      const k = els.filter((e) => e.src === this.src).indexOf(this);
      return new Promise((ok) => script(this, k, ok));
    }
    pause() { this.paused = true; }
    load() {}
  }
  return { FakeAudio, els };
}
/** Starts at `at` ms (currentTime `t`), then `waiting` and nothing more. */
const stallAt = (at, t) => (a, k, ok) => {
  setTimeout(() => { a.currentTime = t; ok(); a.emit('playing'); a.emit('timeupdate'); a.emit('waiting'); }, at);
};
/** Plays to its end: `playing` at `at`, `ended` at `at + len`. */
const plays = (at, len) => (a, k, ok) => {
  setTimeout(() => { a.currentTime = 0.01; ok(); a.emit('playing'); a.emit('timeupdate'); }, at);
  setTimeout(() => { a.currentTime = a.duration; a.paused = true; a.ended = true; a.emit('timeupdate'); a.emit('ended'); }, at + len);
};

function voiceWith(script, extra) {
  const s = stubAudio(script);
  jest.resetModules();
  const v = require(VOICE).create(Object.assign({ lang: 'ur', base: '/', Audio: s.FakeAudio, document: { visibilityState: 'visible' } }, extra || {}));
  return { v, els: s.els };
}
/** speak() → { st: 'pending'|'resolved'|'rejected', at, err } */
function track(p) {
  const r = { st: 'pending', at: null, err: null };
  p.then(() => { r.st = 'resolved'; r.at = Date.now(); }, (e) => { r.st = 'rejected'; r.at = Date.now(); r.err = e; });
  return r;
}
const CLIP = 'sa/v5/ur/ls_1.mp3';
const STALL_MS = 5000; // the no-progress window (the clip load window)
const RETRY_MS = 1500;

describe('clip_only: a clip that starts and then stalls (the real voice, a stub Audio)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
  afterEach(() => { jest.useRealTimers(); });

  test('(i) playing at 0.4 s, then waiting and nothing: tried once more from 0, the second stall REJECTS within 2 x window + retry', async () => {
    const x = voiceWith(stallAt(400, 0.4));
    const r = track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(2 * STALL_MS + RETRY_MS);
    expect(r.st).toBe('rejected');
    expect(r.err && r.err.message).toBe('clip_unavailable');
    expect(r.at).toBeLessThanOrEqual(2 * STALL_MS + RETRY_MS);
    expect(x.els).toHaveLength(2); // one retry, from the start of the clip
    expect(x.els[1].currentTime).toBe(0.4); // the retry played from 0 to its own stall, not resumed at the first's
  });

  test('(i) the first stall alone does not reject: the retry that then plays to its end is heard', async () => {
    let n = 0;
    const x = voiceWith((a, k, ok) => (n++ === 0 ? stallAt(400, 0.4) : plays(300, 1200))(a, k, ok));
    const r = track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(STALL_MS + 400 + 300 + 1200 + 50);
    expect(r.st).toBe('resolved');
    expect(x.els).toHaveLength(2);
  });

  test('(i) playing, one timeupdate, then nothing at all (no waiting, no stalled): the clock is the progress, not an event; REJECTS', async () => {
    const x = voiceWith((a, k, ok) => {
      setTimeout(() => { ok(); a.emit('playing'); }, 10);
      setTimeout(() => { a.currentTime = 0.5; a.emit('timeupdate'); }, 400);
    });
    const r = track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(2 * STALL_MS + RETRY_MS);
    expect(r.st).toBe('rejected');
    expect(r.at).toBeLessThanOrEqual(2 * STALL_MS + RETRY_MS);
    expect(x.els).toHaveLength(2);
  });

  test('slow but progressing (a timeupdate every 1.5 s for 12 s): never a stall, heard to its end', async () => {
    const x = voiceWith((a, k, ok) => {
      setTimeout(() => { ok(); a.emit('playing'); }, 10);
      for (let t = 1500; t <= 12000; t += 1500) setTimeout(() => { a.currentTime += 0.5; a.emit('timeupdate'); }, t);
      setTimeout(() => { a.ended = true; a.paused = true; a.emit('ended'); }, 12100);
    });
    const r = track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(13000);
    expect(r.st).toBe('resolved');
    expect(r.at).toBe(12100);
    expect(x.els).toHaveLength(1);
  });

  test('a 3 s waiting that recovers (playing again, then progress, then ended): heard, never retried', async () => {
    const x = voiceWith((a, k, ok) => {
      setTimeout(() => { ok(); a.emit('playing'); }, 10);
      setTimeout(() => { a.currentTime = 0.5; a.emit('timeupdate'); }, 400);
      setTimeout(() => a.emit('waiting'), 450);
      setTimeout(() => a.emit('playing'), 3450);
      for (let t = 3500; t <= 5000; t += 300) setTimeout(() => { a.currentTime += 0.5; a.emit('timeupdate'); }, t);
      setTimeout(() => { a.ended = true; a.paused = true; a.emit('ended'); }, 5100);
    });
    const r = track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(6000);
    expect(r.st).toBe('resolved');
    expect(r.at).toBe(5100);
    expect(x.els).toHaveLength(1);
  });

  test('a stall that resumes within the window: no retry, the clip is heard to its end', async () => {
    const x = voiceWith((a, k, ok) => {
      stallAt(400, 0.4)(a, k, ok);
      setTimeout(() => { a.currentTime = 0.5; a.emit('playing'); a.emit('timeupdate'); }, 4400);
      setTimeout(() => { a.currentTime = 1.0; a.emit('timeupdate'); }, 4900);
      setTimeout(() => { a.currentTime = 1.5; a.ended = true; a.paused = true; a.emit('ended'); }, 5400);
    });
    const r = track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(6000);
    expect(r.st).toBe('resolved');
    expect(x.els).toHaveLength(1);
  });

  test('the 60 s never-ended guard under clip_only: a clip that creeps on but never ends REJECTS, never counts as heard', async () => {
    const x = voiceWith((a, k, ok) => {
      setTimeout(() => { a.currentTime = 0.01; ok(); a.emit('playing'); a.emit('timeupdate'); }, 100);
      for (let i = 1; i <= 20; i++) setTimeout(() => { a.currentTime = 0.01 * (i + 1); a.emit('timeupdate'); }, 100 + i * 4000);
    });
    const r = track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(60000);
    expect(r.st).toBe('rejected');
    expect(r.at).toBe(60000);
    expect(x.els).toHaveLength(1);
  });

  test('(v) speak.stalled() is true from the stall until the line ends, false while the clip makes progress', async () => {
    const x = voiceWith(stallAt(400, 0.4));
    track(x.v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(300);
    expect(x.v.speak.stalled()).toBe(false);
    await jest.advanceTimersByTimeAsync(200); // waiting at 0.4 s
    expect(x.v.speak.stalled()).toBe(true);
    await jest.advanceTimersByTimeAsync(STALL_MS + 100); // the retry, still not past its own stall
    expect(x.v.speak.stalled()).toBe(true);
    await jest.advanceTimersByTimeAsync(2 * STALL_MS);
    expect(x.v.speak.stalled()).toBe(false); // the line is over (rejected)
  });

  test('(iii) OFF identity: the same stall WITHOUT clip_only resolves at the 60 s guard as today, never retried', async () => {
    const x = voiceWith(stallAt(400, 0.4));
    const r = track(x.v.speak(null, CLIP));
    await jest.advanceTimersByTimeAsync(59999);
    expect(r.st).toBe('pending');
    await jest.advanceTimersByTimeAsync(1);
    expect(r.st).toBe('resolved');
    expect(x.els).toHaveLength(1);
  });
});

/**
 * A page hidden for longer than the 60 s line guard (a coach takes a call): the browser refuses play() while hidden and
 * pauses a playing clip on hide; showing the page again calls resume(), as the engine does. Under clip_only the 60 s
 * guard does not count the time a line is held for a hidden page: it starts a full 60 s again on show.
 */
function hiddenWorld(deadAfterShow) {
  const w = { doc: { visibilityState: 'visible' }, els: [], shown: false };
  class A {
    constructor(src) { this.src = src; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 3; this.ls = {}; this.iv = null; w.els.push(this); }
    addEventListener(t, f) { (this.ls[t] = this.ls[t] || []).push(f); }
    removeEventListener() {}
    fire(t) { if (this['on' + t]) this['on' + t]({ type: t }); (this.ls[t] || []).forEach((f) => f({ type: t })); }
    pause() { if (!this.paused) { this.paused = true; if (this.iv) clearInterval(this.iv); this.iv = null; this.fire('pause'); } }
    load() {}
    play() {
      if (w.doc.visibilityState === 'hidden') return Promise.reject(Object.assign(new Error('hidden'), { name: 'NotAllowedError' }));
      this.paused = false;
      const dead = deadAfterShow && w.shown;
      setTimeout(() => {
        if (this.paused) return;
        this.fire('playing');
        let n = 0;
        this.iv = setInterval(() => {
          if (dead && ++n > 1) return; // after the show: one step, then the network dies (no event, no progress)
          this.currentTime = Math.min(this.duration, this.currentTime + 0.25); this.fire('timeupdate');
          if (this.currentTime >= this.duration) { clearInterval(this.iv); this.iv = null; this.paused = true; this.ended = true; this.fire('ended'); }
        }, 250);
      }, 50);
      return Promise.resolve();
    }
  }
  w.A = A;
  return w;
}

describe('clip_only and a page hidden for longer than the 60 s guard (the real voice, a stub Audio)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
  afterEach(() => { jest.useRealTimers(); });
  const CASES = [
    // name, hide at ms (-1: before the line), show at ms, dead after the show, want, the clip ended, window [from, to] ms
    ['hidden 1.2 s into the clip, shown at 20 s: heard to its end after the show', 1200, 20000, false, 'resolved', true, [20000, 25000]],
    ['hidden 1.2 s into the clip, shown at 70 s: heard to its end after the show, not given up at 60 s', 1200, 70000, false, 'resolved', true, [70000, 75000]],
    ['hidden before the line, shown at 30 s: the clip plays on show and is heard', -1, 30000, false, 'resolved', true, [30000, 36000]],
    ['hidden before the line, shown at 90 s: the clip plays on show and is heard, not given up at 60 s', -1, 90000, false, 'resolved', true, [90000, 96000]],
    ['hidden 1.2 s in, shown at 70 s, then the clip stalls dead: given up within about 11 s of the show', 1200, 70000, true, 'rejected', false, [70000, 83500]],
  ];
  test.each(CASES)('%s', async (name, hideAt, showAt, dead, want, ended, win) => {
    const w = hiddenWorld(dead);
    jest.resetModules();
    const v = require(VOICE).create({ lang: 'ur', base: '/', Audio: w.A, document: w.doc });
    const hide = () => { w.doc.visibilityState = 'hidden'; w.els.forEach((a) => a.pause()); };
    if (hideAt < 0) hide(); else setTimeout(hide, hideAt);
    setTimeout(() => { w.doc.visibilityState = 'visible'; w.shown = true; v.resume(); }, showAt);
    const r = track(v.speak(null, CLIP, { clip_only: true }));
    await jest.advanceTimersByTimeAsync(win[1] + 1000);
    expect(r.st).toBe(want);
    expect(r.at).toBeGreaterThanOrEqual(win[0]);
    expect(r.at).toBeLessThanOrEqual(win[1]);
    expect(w.els.some((a) => a.ended)).toBe(ended);
    v.stop();
  });

  test('without clip_only the 60 s guard still counts hidden time, as today', async () => {
    const w = hiddenWorld(false);
    jest.resetModules();
    const v = require(VOICE).create({ lang: 'ur', base: '/', Audio: w.A, document: w.doc });
    setTimeout(() => { w.doc.visibilityState = 'hidden'; w.els.forEach((a) => a.pause()); }, 1200);
    const r = track(v.speak(null, CLIP));
    await jest.advanceTimersByTimeAsync(60000);
    expect(r.st).toBe('resolved');
    expect(r.at).toBe(60000);
  });
});

// ---------- the screens (jsdom): the real voice under sa-ui.js ----------
const core = require('../sa/sa-core');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) {
  try { ({ JSDOM } = require(path.join(__dirname, '../../portal/node_modules/jsdom'))); } catch (__) { /* not installed here */ }
}
const maybe = JSDOM ? describe : describe.skip;

// the real voice with a short window, so a stall is given up in a few hundred ms of real time
const VO = { load_ms: 150, retry_ms: 20, progress_ms: 150, pause_ms: 5 };
const GIVE_UP_MS = 2 * (VO.progress_ms + 20) + VO.retry_ms + 400; // two stalls + the retry, with slack
const okClip = plays(10, 30);
const stallClip = stallAt(10, 0.6); // 0.6 s in: past the picker's 450 ms pre-sound window

// MCQ fixtures (synthetic)
const q = (n, key) => ({
  id: `ur.story_w3.q${n}`, prompt: { text: `question ${n}`, audio: `sa/v5/ur/syn_q${n}.mp3` },
  options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`], option_audio: [1, 2, 3, 4].map((k) => `sa/v5/ur/syn_q${n}_o${k}.mp3`),
  target_index: key - 1, key, src: 'synthetic',
});
function mcqBattery() {
  return { battery_id: 'b', ui: { r28_mcq: true }, tasks: [{
    id: 'ur.story_mcq_w3', w3: true, r28: 'mcq', replaces: 'ur.story_comp_w3', kind: 'mcq', response: 'tap',
    subtask: 'reading_comprehension', lang: 'ur', title: { en: 'Story questions', ur: 'کہانی کے سوال' }, time_limit_s: null, stop: {},
    replay_at_s: 10, next_at_s: 15, depends_on: null, items: [q(1, 2), q(2, 3)],
  }] };
}
// picker fixtures (synthetic)
const POOL = ['ب', 'پ', 'ت', 'ٹ', 'ث', 'ن', 'م', 'ک', 'س', 'ر', 'ج', 'د'];
const TARGETS = ['ب', 'م', 'ک', 'س', 'ر', 'ج', 'د', 'ت', 'پ', 'ن'];
function optionsFor(target, i) { const rest = POOL.filter((x) => x !== target).slice(i % 3, (i % 3) + 4); rest.splice(i % 5, 0, target); return rest; }
function pickBattery() {
  const id = 'ur.letter_pick10';
  return { battery_id: 'r28a', ui: { r28_letter_pick: true }, tasks: [{
    id, w3: true, r28: 'letter_pick', replaces: 'ur.letter_sounds5', kind: 'pick', response: 'tap',
    subtask: 'letter_sound_identification', lang: 'ur', title: { en: 'Listen and pick', ur: 'سنیں اور چنیں' }, time_limit_s: null,
    stop: {}, replay_at_s: 10, next_at_s: 15, instruction: { text: 'instruction', audio: 'sa/v5/ur/lp_intro.mp3' }, script: {},
    coach_text: { text: 'coach', src: 'fixture' }, practice: [],
    items: TARGETS.map((target, i) => ({ id: `${id}.${String(i + 1).padStart(2, '0')}`, options: optionsFor(target, i), target,
      prompt_audio: `sa/v5/ur/ls_${i + 1}.mp3`, prompt_text: `${target}َ`, src: 'fixture' })),
  }, { id: 'ma.after', mode: 'tap', items: [{ id: 'a1', target: '1', options: ['1', '2'] }] }] };
}

maybe('the screens: a stalled clip on the first play vs on a replay (real voice, jsdom)', () => {
  let dom;
  const keep = {};
  let views = [];
  let voices = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => {
    views.forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); views = [];
    voices.forEach((v) => { try { v.stop(); } catch (_) { /* gone */ } }); voices = [];
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { for (let t = 0; t < ms && !fn(); t += 10) await wait(10); return fn(); };

  /** script(src, k): the behaviour of the k-th element made for src. */
  function mount(battery, script, r28) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const s = stubAudio((a, k, ok) => script(a.src.replace(/^\//, ''), k)(a, k, ok));
    const voice = require(VOICE).create(Object.assign({ lang: 'ur', base: '/', Audio: s.FakeAudio, document: dom.window.document }, VO));
    voices.push(voice);
    const events = [];
    const r = c.createRunner({ battery, onEvent: (e) => events.push(e) });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner: r, battery, lang: 'ur', mode: 'proctored', handover: false, speak: voice.speak, r28 });
    views.push(view);
    r.start(); r.instructionDone(); r.begin(); view.render();
    return { r, el, events, els: s.els };
  }
  const MCQ = { letter_pick: false, mcq: true, ceiling: false };
  const PICK = { letter_pick: true };
  const mcqCards = (el) => Array.from(el.querySelectorAll('.sae-mcq-opt'));
  const pickCards = (el) => Array.from(el.querySelectorAll('.sae-pick-cards .sae-opt'));
  const madeFor = (m, src) => m.els.filter((a) => a.src === '/' + src);
  const lost = (m) => m.events.filter((e) => e.type === 'replay' && e.value === 'lost');

  test('(ii) MCQ: option 2 stalls on the first read-out (and on its retry): the question is unavailable, no choice, never wrong; the next one is asked', async () => {
    const O2 = 'sa/v5/ur/syn_q1_o2.mp3';
    const m = mount(mcqBattery(), (src) => (src === O2 ? stallClip : okClip), MCQ);
    expect(await until(() => madeFor(m, O2).length > 0, 3000)).toBe(true);
    await until(() => m.r.view().item && m.r.view().item.id === 'ur.story_w3.q2', GIVE_UP_MS);
    expect(m.r.view().item.id).toBe('ur.story_w3.q2');
    expect(madeFor(m, O2)).toHaveLength(2); // one retry
    // q2 is read whole and answered
    await until(() => m.el.querySelector('.sae-mcq') && !m.el.querySelector('.sae-mcq-replay').disabled, 4000);
    mcqCards(m.el)[2].click();
    await until(() => m.r.view().phase !== 'running', 2000);
    const res = m.r.results()[0];
    expect(res.answers[0]).toEqual({ item_id: 'ur.story_w3.q1', value: null, unavailable: 'clip' });
    expect(res.asked).toEqual(['ur.story_w3.q2']);
    expect(res.incorrect).toBe(0);
    expect(res.correct).toBe(1);
    expect(m.events.filter((e) => e.type === 'item_unavailable').map((e) => e.item_id)).toEqual(['ur.story_w3.q1']);
  }, 15000);

  test('(v) MCQ: a tap during a first-read-out stall is dropped, never held, even when the clip then plays on', async () => {
    const O2 = 'sa/v5/ur/syn_q1_o2.mp3';
    const resume = (a, k, ok) => {
      stallClip(a, k, ok);
      setTimeout(() => { a.currentTime = 0.7; a.emit('playing'); a.emit('timeupdate'); }, 110);
      setTimeout(() => { a.currentTime = 1.5; a.paused = true; a.ended = true; a.emit('ended'); }, 130);
    };
    const m = mount(mcqBattery(), (src) => (src === O2 ? resume : okClip), MCQ);
    expect(await until(() => madeFor(m, O2).length > 0 && madeFor(m, O2)[0].currentTime === 0.6, 3000)).toBe(true);
    mcqCards(m.el)[1].click(); // in the stall
    expect(mcqCards(m.el).map((c) => c.classList.contains('is-chosen'))).toEqual([false, false, false, false]);
    await until(() => !m.el.querySelector('.sae-mcq-replay').disabled, 3000); // the read-out ends
    await wait(800); // past the 600 ms settle
    expect(m.r.snapshot().current.answers).toHaveLength(0); // nothing stood
    expect(m.r.view().item.id).toBe('ur.story_w3.q1');
    expect(madeFor(m, O2)).toHaveLength(1); // resumed inside the window: never retried
  }, 15000);

  test('(iv) MCQ: the same stall on a REPLAY after a whole first read-out ends that replay; the question stays asked and a later tap scores', async () => {
    const Q1 = 'sa/v5/ur/syn_q1.mp3';
    const m = mount(mcqBattery(), (src, k) => (src === Q1 && k >= 1 ? stallClip : okClip), MCQ);
    await until(() => m.el.querySelector('.sae-mcq-replay') && !m.el.querySelector('.sae-mcq-replay').disabled, 4000);
    m.el.querySelector('.sae-mcq-replay').click();
    expect(await until(() => madeFor(m, Q1).length >= 2, 1000)).toBe(true);
    await until(() => lost(m).length > 0, GIVE_UP_MS);
    expect(lost(m)).toHaveLength(1);
    expect(m.events.filter((e) => e.type === 'item_unavailable')).toHaveLength(0);
    expect(m.r.view().item.id).toBe('ur.story_w3.q1');
    await until(() => !m.el.querySelector('.sae-mcq-replay').disabled, 1000);
    mcqCards(m.el)[1].click();
    await until(() => m.r.snapshot().current.answers.length > 0, 1500);
    expect(m.r.snapshot().current.answers[0]).toMatchObject({ item_id: 'ur.story_w3.q1', value: 1, ok: true });
  }, 15000);

  test('(ii) picker: the item\'s first play stalls (and its retry): the item is unavailable, not presented; the next item\'s sound plays', async () => {
    const L1 = 'sa/v5/ur/ls_1.mp3';
    const m = mount(pickBattery(), (src) => (src === L1 ? stallClip : okClip), PICK);
    expect(await until(() => madeFor(m, L1).length > 0, 2000)).toBe(true);
    await until(() => m.r.view().item && m.r.view().item.id === 'ur.letter_pick10.02', GIVE_UP_MS);
    expect(m.r.view().item.id).toBe('ur.letter_pick10.02');
    expect(madeFor(m, L1)).toHaveLength(2);
    expect(m.r.snapshot().current.answers[0]).toEqual({ item_id: 'ur.letter_pick10.01', value: null, unavailable: 'clip' });
    expect(await until(() => madeFor(m, 'sa/v5/ur/ls_2.mp3').length > 0, 1500)).toBe(true);
  }, 15000);

  test('(v) picker: a tap during the first-play stall is dropped (not scored); the item is then given up, not wrong', async () => {
    const L1 = 'sa/v5/ur/ls_1.mp3';
    const m = mount(pickBattery(), (src) => (src === L1 ? stallClip : okClip), PICK);
    expect(await until(() => madeFor(m, L1).length > 0 && madeFor(m, L1)[0].currentTime === 0.6, 2000)).toBe(true);
    await wait(30);
    pickCards(m.el)[0].click();
    expect(m.r.snapshot().current.answers).toHaveLength(0);
    expect(m.r.view().item.id).toBe('ur.letter_pick10.01');
    await until(() => m.r.view().item.id !== 'ur.letter_pick10.01', GIVE_UP_MS);
    expect(m.r.snapshot().current.answers[0]).toEqual({ item_id: 'ur.letter_pick10.01', value: null, unavailable: 'clip' });
  }, 15000);

  test('(iv) picker: a stall on the child\'s REPLAY ends that replay; the item stays open and a tap scores', async () => {
    const L1 = 'sa/v5/ur/ls_1.mp3';
    const m = mount(pickBattery(), (src, k) => (src === L1 && k >= 1 ? stallClip : okClip), PICK);
    expect(await until(() => madeFor(m, L1).length > 0 && madeFor(m, L1)[0].ended, 2000)).toBe(true);
    await wait(50);
    m.el.querySelector('.sae-pick-replay').click();
    expect(await until(() => madeFor(m, L1).length >= 2, 1000)).toBe(true);
    await until(() => lost(m).length > 0, GIVE_UP_MS);
    expect(lost(m)).toHaveLength(1);
    expect(m.events.filter((e) => e.type === 'item_unavailable')).toHaveLength(0);
    const it = m.r.view().item;
    expect(it.id).toBe('ur.letter_pick10.01');
    pickCards(m.el)[0].click();
    expect(m.r.snapshot().current.answers[0]).toMatchObject({ item_id: it.id, value: it.options[0], replays: 1 });
  }, 15000);
  test('the cards through a first-play stall: picker cards keep the look they have while the sound plays and take no press; MCQ cards stay waiting, none ready or chosen', async () => {
    const L1 = 'sa/v5/ur/ls_1.mp3';
    const p = mount(pickBattery(), (src) => (src === L1 ? stallClip : okClip), PICK);
    expect(await until(() => madeFor(p, L1).length > 0 && madeFor(p, L1)[0].currentTime === 0.6, 2000)).toBe(true);
    const look = (m) => pickCards(m.el).map((c) => [c.className, !!c.disabled, c.getAttribute('aria-disabled')]);
    const playingLook = look(p); // the clip has started: the look the cards have while the sound plays
    await wait(60); // now in the stall
    expect(madeFor(p, L1)[0].ended).toBe(false);
    expect(look(p)).toEqual(playingLook);
    pickCards(p.el)[0].click();
    expect(pickCards(p.el).some((c) => c.classList.contains('is-pressed'))).toBe(false); // no tappable feedback
    expect(look(p)).toEqual(playingLook);
    views.forEach((v) => v.destroy()); views = []; voices.forEach((v) => v.stop()); voices = [];
    document.getElementById('m').innerHTML = '';

    const O2 = 'sa/v5/ur/syn_q1_o2.mp3';
    const m = mount(mcqBattery(), (src) => (src === O2 ? stallClip : okClip), MCQ);
    expect(await until(() => madeFor(m, O2).length > 0 && madeFor(m, O2)[0].currentTime === 0.6, 3000)).toBe(true);
    await wait(60);
    const cls = (c) => ['is-waiting', 'is-speaking', 'is-ready', 'is-chosen'].filter((k) => c.classList.contains(k));
    expect(mcqCards(m.el).map(cls)).toEqual([['is-waiting'], ['is-speaking'], ['is-waiting'], ['is-waiting']]);
    mcqCards(m.el)[2].click();
    expect(mcqCards(m.el).map(cls)).toEqual([['is-waiting'], ['is-speaking'], ['is-waiting'], ['is-waiting']]);
  }, 15000);
});
