/**
 * The big flight's skin on the child's page (dashboard/sa/skin-game.js, ?skin=game): the game sink only for a run whose
 * token the game page kept, every sink call waiting for sink-game.js; Jugnu's glow only while a timed task runs, as the
 * engine's own share of the minute left; the task's end plays the kit's sound, and a scored item never does. Run in a vm
 * with a stand-in document, engine and sound kit. Invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'sa', 'skin-game.js'), 'utf8');

function el() {
  const e = { className: '', style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, attrs: {}, listeners: {}, children: [], textContent: '', innerHTML: '' };
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.addEventListener = (k, fn) => { e.listeners[k] = fn; };
  e.appendChild = (c) => { e.children.push(c); if (c.src && c.onload) setImmediate(() => c.onload()); return c; };
  return e;
}
function setup({ kept = {}, sinkGame = null } = {}) {
  const head = el();
  const body = el();
  const timers = [];
  const W = {
    document: { head, body, createElement: () => el() },
    localStorage: { getItem: (k) => (k in kept ? kept[k] : null) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    SAE: sinkGame ? { sinkGame } : undefined,
  };
  vm.runInNewContext(SRC, { window: W, Promise, Math, String });
  return { W, head, body, timers };
}
function engine() {
  const hooks = {};
  return { hooks, muted: [], on(n, fn) { (hooks[n] = hooks[n] || []).push(fn); return this; }, mute(b) { this.muted.push(b); }, fire(n, v) { (hooks[n] || []).forEach((f) => f(v)); } };
}

test('no kept token: no sink (the run stays on the phone)', () => {
  const { W } = setup();
  expect(W.SAE.sinks.game({ session_id: 'sess-1' })).toBeNull();
});

test('a kept token: the sink forwards each call to sink-game.js with that token', async () => {
  const calls = [];
  const sinkGame = { create: (o) => ({ putBatch: (b) => { calls.push(['batch', o, b]); return Promise.resolve({ ok: true, acked_to: 3 }); } }) };
  const { W } = setup({ kept: { 'sg.st.sess-1': 'st-token' }, sinkGame });
  const sink = W.SAE.sinks.game({ session_id: 'sess-1' });
  expect(await sink.putBatch({ seq_to: 3 })).toEqual({ ok: true, acked_to: 3 });
  expect(calls[0][1]).toEqual({ st: 'st-token', session_id: 'sess-1' });
  await expect(sink.presignAudio({})).rejects.toThrow('sink_unavailable');
});

test('glow: on only while a timed task runs, scaled to the time left; sounds on task end, never on a scored item', () => {
  const { W, body, timers } = setup();
  const sounds = [];
  W.WQJ = { muted: () => false, mute() {}, sentence: () => sounds.push('sentence'), finish: () => sounds.push('finish'), correct: () => sounds.push('correct'), wrong: () => sounds.push('wrong') };
  const e = engine();
  W.__sae = e;
  timers.find((t) => t.ms === 100).fn();
  const glow = body.children.find((c) => /sg-glow/.test(c.className));
  e.fire('state', { phase: 'running', task: { time_limit_s: 60 }, time_left_ms: 30000 });
  expect(glow.className).toBe('sg-glow is-on');
  expect(glow.style.props['--glow']).toBe('0.5');
  e.fire('state', { phase: 'running', task: { time_limit_s: null }, time_left_ms: null });
  expect(glow.className).toBe('sg-glow');
  e.fire('correct', {}); e.fire('incorrect', {});
  e.fire('task_end', {});
  e.fire('battery_end', {});
  expect(sounds).toEqual(['sentence', 'finish']);
});

test('the mute is the sound kit only: Jugnu\'s words are never muted', () => {
  const { W, body, timers } = setup();
  let m = false;
  W.WQJ = { muted: () => m, mute: (b) => { m = b; }, sentence() {}, finish() {} };
  const e = engine();
  W.__sae = e;
  timers.find((t) => t.ms === 100).fn();
  const btn = body.children.find((c) => c.className === 'sg-mute');
  btn.listeners.click();
  expect(m).toBe(true);
  expect(e.muted).toEqual([]);
});
