'use strict';
/**
 * The phone's microphone record (dashboard/sa/sa-mic.js): read the way both writers store it (the game's mic check
 * '1'/'0', the coach pre-flight's JSON), written by the game's check, unknown when nothing is stored.
 */
const mic = require('../sa/sa-mic');

function mem(init) { const m = Object.assign({}, init); return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, m }; }

test('reads both writers; anything else is unknown', () => {
  expect(mic.state(mem({}))).toBe('unknown');
  expect(mic.state(mem({ 'sa:mic_ok': '1' }))).toBe('ok');
  expect(mic.state(mem({ 'sa:mic_ok': '0' }))).toBe('no');
  expect(mic.state(mem({ 'sa:mic_ok': JSON.stringify({ ok: true, mic_rms: 0.2 }) }))).toBe('ok');
  expect(mic.state(mem({ 'sa:mic_ok': JSON.stringify({ mic_ok: false }) }))).toBe('no');
  expect(mic.state(mem({ 'sa:mic_ok': 'garbage' }))).toBe('unknown');
});

test('the game check is remembered with its level', () => {
  const s = mem({});
  mic.remember(true, 0.034567, s);
  expect(s.m).toEqual({ 'sa:mic_ok': '1', 'sa:mic_rms': '0.0346' });
  expect(mic.state(s)).toBe('ok');
});

test('the RMS of 8-bit samples (128 = silence)', () => {
  expect(mic.rmsOf(new Uint8Array([128, 128, 128]))).toBe(0);
  expect(mic.rmsOf(new Uint8Array([192, 64]))).toBeCloseTo(0.5, 5);
});

test('a failed game check is not kept (asked again next run); a pass stays', () => {
  const s = mem({});
  mic.remember(false, 0, s);
  expect(mic.state(s)).toBe('unknown');
  mic.remember(true, 0.05, s);
  mic.remember(false, 0, s);
  expect(mic.state(s)).toBe('ok');
});
