'use strict';
/**
 * The recorder (dashboard/sa/sa-rec.js): the portal's type order; each second's chunk on the phone as it comes; stop
 * writes the final marker with the duration; a refused microphone or no MediaRecorder says so instead of throwing.
 */
const storeMod = require('../sa/sa-store');
const rec = require('../sa/sa-rec');

class FakeMR {
  static isTypeSupported(t) { return t === 'audio/webm' || t === 'audio/mp4'; }
  constructor(stream, o) { this.o = o; FakeMR.last = this; }
  start(ms) { this.slice = ms; }
  emit(data) { this.ondataavailable({ data }); }
  stop() { this.onstop(); }
}

test('the first supported type in the portal order', () => {
  expect(rec.pickType(FakeMR)).toEqual({ mimeType: 'audio/webm', ext: '.webm' });
  expect(rec.pickType(undefined)).toBeNull();
});

test('chunks land as they come; stop closes the file with its duration', async () => {
  const s = await storeMod.open({ idb: null });
  let t = 0;
  const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => ({ getTracks: () => [] }), now: () => t });
  expect(r.start('t1')).toBe(false); // no microphone yet
  expect(await r.ready()).toBe(true);
  expect(r.start('t1')).toBe(true);
  expect(FakeMR.last.slice).toBe(1000);
  FakeMR.last.emit({ size: 3, id: 'a' });
  FakeMR.last.emit({ size: 0 });
  FakeMR.last.emit({ size: 2, id: 'b' });
  t = 4200;
  const meta = await r.stop();
  expect(meta).toEqual({ task_id: 't1', parts: 2, duration_ms: 4200, mime: 'audio/webm' });
  const c = await s.chunks('x', 't1');
  expect(c.map((x) => [x.part, x.blob && x.blob.id, !!x.final])).toEqual([[0, 'a', false], [1, 'b', false], [2, null, true]]);
  expect(c[2].duration_ms).toBe(4200);
});

test('a refused microphone or no recorder: ready() is false, nothing throws', async () => {
  const s = await storeMod.open({ idb: null });
  const a = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => { throw new Error('denied'); } });
  expect(await a.ready()).toBe(false);
  const b = rec.create({ store: s, session_id: 'x', MediaRecorder: { isTypeSupported: () => false }, getUserMedia: async () => ({}) });
  expect(b.supported()).toBe(false);
  expect(await b.ready()).toBe(false);
  expect(await b.stop()).toBeNull();
});
