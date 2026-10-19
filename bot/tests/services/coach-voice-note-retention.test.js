'use strict';
/**
 * bd-v0toag.67: a teacher's voice note for her coach is deleted 30 days after it was saved, if the coach has
 * not marked the visit done first. The sweep runs for real here; the Supabase client and R2 are the
 * boundaries, faked so every query and every delete can be read back.
 */
const { sweepExpiredVoiceNotes } = require('../../shared/services/coach-voice-note-retention.service');

const NOW = Date.parse('2026-10-16T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A fake Supabase client: records every chained call; select resolves `rows`, update resolves `updateResult`. */
function fakeDb({ rows = [], selectError = null, updateResult = { error: null } } = {}) {
  const calls = [];
  const from = (table) => {
    const q = { table, ops: [] };
    calls.push(q);
    const b = {};
    for (const op of ['select', 'update', 'not', 'lt', 'eq', 'order', 'limit']) {
      b[op] = (...a) => { q.ops.push([op, ...a]); return b; };
    }
    b.then = (res, rej) => {
      const isUpdate = q.ops.some(([op]) => op === 'update');
      const out = isUpdate ? updateResult : { data: selectError ? null : rows, error: selectError };
      return Promise.resolve(out).then(res, rej);
    };
    return b;
  };
  return { db: { from }, calls };
}

const quietLog = () => ({ logEvent: jest.fn(), logToFile: jest.fn() });

test('an old note is deleted from R2 and its key nulled; the query is bounded, oldest first, keyed rows older than 30 days only', async () => {
  const { db, calls } = fakeDb({ rows: [{ id: 'r1', voice_note_key: 'coach-visit-notes/r1.ogg' }] });
  const deleteKey = jest.fn(async () => true);
  const out = await sweepExpiredVoiceNotes({ now: NOW, deps: { supabase: db, deleteKey, ...quietLog() } });

  expect(out).toEqual({ checked: 1, deleted: 1, failed: 0 });
  const [select, update] = calls;
  expect(select.table).toBe('coach_visit_requests');
  expect(select.ops).toEqual([
    ['select', 'id, voice_note_key'],
    ['not', 'voice_note_key', 'is', null],
    ['lt', 'created_at', new Date(NOW - 30 * DAY).toISOString()],
    ['order', 'created_at', { ascending: true }],
    ['limit', 200],
  ]);
  expect(deleteKey).toHaveBeenCalledWith('coach-visit-notes/r1.ogg');
  expect(update.table).toBe('coach_visit_requests');
  expect(update.ops[0][0]).toBe('update');
  expect(update.ops[0][1]).toEqual({ voice_note_key: null, updated_at: new Date(NOW).toISOString() });
  // nulls only the key it deleted: a row whose key changed in between is left alone
  expect(update.ops.slice(1)).toEqual([['eq', 'id', 'r1'], ['eq', 'voice_note_key', 'coach-visit-notes/r1.ogg']]);
});

test('an R2 delete that fails, or throws, leaves the key so the next run retries', async () => {
  const { db, calls } = fakeDb({ rows: [
    { id: 'r1', voice_note_key: 'coach-visit-notes/r1.ogg' },
    { id: 'r2', voice_note_key: 'coach-visit-notes/r2.m4a' },
  ] });
  const deleteKey = jest.fn()
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error('bucket down'));
  const out = await sweepExpiredVoiceNotes({ now: NOW, deps: { supabase: db, deleteKey, ...quietLog() } });
  expect(out).toEqual({ checked: 2, deleted: 0, failed: 2 });
  expect(calls.filter((q) => q.ops.some(([op]) => op === 'update'))).toEqual([]);
});

test('the age and the batch size are parameters, and nothing to sweep deletes nothing', async () => {
  const { db, calls } = fakeDb({ rows: [] });
  const deleteKey = jest.fn();
  const out = await sweepExpiredVoiceNotes({ now: NOW, maxAgeDays: 7, limit: 5, deps: { supabase: db, deleteKey, ...quietLog() } });
  expect(out).toEqual({ checked: 0, deleted: 0, failed: 0 });
  expect(calls[0].ops).toContainEqual(['lt', 'created_at', new Date(NOW - 7 * DAY).toISOString()]);
  expect(calls[0].ops).toContainEqual(['limit', 5]);
  expect(deleteKey).not.toHaveBeenCalled();
});

test('a failed read or a failed null-out is logged and counted, never thrown', async () => {
  const log = quietLog();
  const bad = fakeDb({ selectError: { message: 'db down' } });
  await expect(sweepExpiredVoiceNotes({ now: NOW, deps: { supabase: bad.db, deleteKey: jest.fn(), ...log } }))
    .resolves.toEqual({ checked: 0, deleted: 0, failed: 0 });
  expect(log.logToFile).toHaveBeenCalledWith(expect.stringContaining('read failed'), expect.objectContaining({ error: 'db down', correlationId: expect.any(String) }), 'error');

  const half = fakeDb({ rows: [{ id: 'r1', voice_note_key: 'k1' }], updateResult: { error: { message: 'write refused' } } });
  const out = await sweepExpiredVoiceNotes({ now: NOW, deps: { supabase: half.db, deleteKey: async () => true, ...log } });
  expect(out).toEqual({ checked: 1, deleted: 0, failed: 1 });
});

test('every run logs its counts with a correlation id', async () => {
  const log = quietLog();
  const { db } = fakeDb({ rows: [{ id: 'r1', voice_note_key: 'k1' }] });
  await sweepExpiredVoiceNotes({ now: NOW, deps: { supabase: db, deleteKey: async () => true, ...log } });
  expect(log.logEvent).toHaveBeenCalledWith('coach_visit.voice_notes_swept', expect.objectContaining({
    checked: 1, deleted: 1, failed: 0, maxAgeDays: 30, correlationId: expect.stringMatching(/^corr-/),
  }));
});
