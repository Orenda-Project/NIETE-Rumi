'use strict';
/**
 * The phone's store (dashboard/sa/sa-store.js): what is written is there after a reopen (IndexedDB), what is pending
 * is exactly what the server has not acknowledged, and a synced session leaves the phone. Runs on the memory backend
 * always, and on IndexedDB when fake-indexeddb resolves (it is a portal dev dependency, not a dashboard one).
 */
const SA = require('../sa/sa-store');

let fakeIdb = null;
try { fakeIdb = require('fake-indexeddb'); } catch (_) { /* not installed here: the IndexedDB leg is skipped */ }

const backends = [['memory', () => SA.open({ idb: null })]];
if (fakeIdb) backends.push(['indexeddb', () => SA.open({ idb: fakeIdb.indexedDB })]);

describe.each(backends)('%s', (kind, open) => {
  test('events, results and chunks are pending until marked synced', async () => {
    const s = await open();
    expect(s.kind).toBe(kind);
    const id = `s-${kind}-1`;
    await s.putSession({ session_id: id, battery_id: 'b' });
    for (let seq = 1; seq <= 4; seq++) await s.appendEvent({ session_id: id, seq, type: 'tap' });
    await s.appendEvent({ session_id: 'other', seq: 1, type: 'tap' });
    await s.putResult(id, { task_id: 'a', correct: 3 });
    await s.putResult(id, { task_id: 'b', correct: 1 });
    await s.putChunk(id, 'b', 0, 'blob0', { mime: 'audio/webm' });
    await s.putChunk(id, 'b', 1, 'blob1');
    let p = await s.pending(id);
    expect(p.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(p.results.map((r) => r.task_id).sort()).toEqual(['a', 'b']);
    expect(p.chunks.map((c) => [c.part, c.blob, c.mime || null])).toEqual([[0, 'blob0', 'audio/webm'], [1, 'blob1', null]]);
    await s.markSynced(id, 3, ['a']);
    await s.markChunksSynced(id, 'b');
    p = await s.pending(id);
    expect(p.events.map((e) => e.seq)).toEqual([4]);
    expect(p.results.map((r) => r.task_id)).toEqual(['b']);
    expect(p.chunks).toEqual([]);
    // a result written again (a resumed task) is pending again
    await s.putResult(id, { task_id: 'a', correct: 4 });
    expect((await s.pending(id)).results.map((r) => r.task_id).sort()).toEqual(['a', 'b']);
    await s.forget(id);
    expect(await s.getSession(id)).toBeNull();
    expect(await s.events(id)).toEqual([]);
    expect((await s.events('other')).length).toBe(1);
  });
});

(fakeIdb ? test : test.skip)('IndexedDB: a reopened store (a reload) still has the session and its log', async () => {
  const a = await SA.open({ idb: fakeIdb.indexedDB });
  await a.putSession({ session_id: 'reload-1', snapshot: { task_index: 2 } });
  await a.appendEvent({ session_id: 'reload-1', seq: 7, type: 'answer' });
  const b = await SA.open({ idb: fakeIdb.indexedDB });
  expect(await b.getSession('reload-1')).toMatchObject({ snapshot: { task_index: 2 } });
  expect((await b.events('reload-1')).map((e) => e.seq)).toEqual([7]);
});

test('a broken IndexedDB falls back to memory and says so', async () => {
  const broken = { open() { const r = {}; setTimeout(() => { r.error = new Error('denied'); r.onerror && r.onerror(); }, 0); return r; } };
  const s = await SA.open({ idb: broken });
  expect(s.kind).toBe('memory');
});
