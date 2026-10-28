'use strict';
/**
 * Round 7b (sa_silence_repeat): recorder.discard() ends a recording with no final marker and takes its chunks off the
 * phone, so the sync never uploads it (a silent attempt; the repeat's recording is the one kept).
 */
const storeMod = require('../sa/sa-store');
const rec = require('../sa/sa-rec');

class FakeMR {
  static isTypeSupported(t) { return t === 'audio/webm'; }
  constructor() { FakeMR.last = this; }
  start() {}
  emit(data) { this.ondataavailable({ data }); }
  stop() { this.onstop(); }
}

test('discard: no final marker, no chunks left; the next recording of the same task starts clean', async () => {
  const s = await storeMod.open({ idb: null });
  const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => ({ getTracks: () => [] }), now: () => 0 });
  await r.ready();
  expect(r.start('t1')).toBe(true);
  FakeMR.last.emit({ size: 3, id: 'a' });
  FakeMR.last.emit({ size: 2, id: 'b' });
  expect(await r.discard()).toBeNull();
  expect(r.recording()).toBe(false);
  expect(await s.chunks('x', 't1')).toEqual([]);
  expect(r.start('t1')).toBe(true);
  FakeMR.last.emit({ size: 4, id: 'c' });
  await r.stop();
  expect((await s.chunks('x', 't1')).map((c) => [c.part, c.blob && c.blob.id, !!c.final])).toEqual([[0, 'c', false], [1, null, true]]);
});

test('discard with nothing recording resolves null', async () => {
  const s = await storeMod.open({ idb: null });
  const r = rec.create({ store: s, session_id: 'x', MediaRecorder: FakeMR, getUserMedia: async () => ({ getTracks: () => [] }) });
  expect(await r.discard()).toBeNull();
});
