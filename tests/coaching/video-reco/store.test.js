'use strict';
/**
 * bd-gzfdu9 — store.js: the recommendation row and the teacher's training ladder. Every function returns,
 * never throws; a DB error is one warn log and the safe answer.
 */
const { fakeSupabase } = require('./fixtures/fake-supabase');

let S;
let db;
let log;
function load(replies) {
  jest.resetModules();
  db = fakeSupabase(replies);
  log = jest.fn();
  jest.doMock('../../../bot/shared/config/supabase', () => db);
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: log, logWarn: jest.fn() }));
  S = require('../../../bot/shared/services/coaching/video-reco/store');
}
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';

test('readForSession → the row by coaching_session_id', async () => {
  load({ video_recommendations: { data: { id: 'r1', status: 'shown' }, error: null } });
  expect(await S.readForSession(SID)).toEqual({ id: 'r1', status: 'shown' });
  expect(db.calls[0]).toEqual(['video_recommendations', ['select', ['*']], ['eq', ['coaching_session_id', SID]], ['maybeSingle', []]]);
});

test('readForSession: error or throw → null + one warn', async () => {
  load({ video_recommendations: new Error('relation does not exist') });
  expect(await S.readForSession(SID)).toBeNull();
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][2]).toBe('warn');
});

test('recentModules: module ids of any status in the last N days, ≤ 500 rows', async () => {
  load({ video_recommendations: { data: [{ module_id: 3 }, { module_id: 9 }, { module_id: 3 }], error: null } });
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T20:00:00Z'));
  expect(await S.recentModules(UID, 180)).toEqual([3, 9]);
  jest.useRealTimers();
  const chain = db.calls[0];
  expect(chain).toContainEqual(['eq', ['user_id', UID]]);
  expect(chain).toContainEqual(['gte', ['created_at', '2026-04-23T20:00:00.000Z']]);
  expect(chain).toContainEqual(['limit', [500]]);
});

test('ladderProgress: the highest Taleemabad-ladder level (ids 1–4) with a completed module, and those module ids', async () => {
  load({ teacher_training_progress: { data: [
    { module_id: 5, training_modules: { training_courses: { level_id: 2 } } },
    { module_id: 50, training_modules: { training_courses: { level_id: 3 } } },
    { module_id: 900, training_modules: { training_courses: { level_id: 18 } } }, // another vendor's "English"
    { module_id: 901, training_modules: { training_courses: { level_id: 30 } } }, // legacy ladder
  ], error: null } });
  expect(await S.ladderProgress(UID)).toEqual({ level: 3, completed: [5, 50] });
  const chain = db.calls[0];
  expect(chain).toContainEqual(['eq', ['user_id', UID]]);
  expect(chain).toContainEqual(['not', ['completed_at', 'is', null]]);
  expect(chain).toContainEqual(['limit', [500]]);
});

test('levelOf: no ladder progress → 2; error → 2', async () => {
  load({ teacher_training_progress: { data: [], error: null } });
  expect(await S.levelOf(UID)).toBe(2);
  load({ teacher_training_progress: { data: null, error: { message: 'boom' } } });
  expect(await S.levelOf(UID)).toBe(2);
  load({ teacher_training_progress: { data: [{ module_id: 1, training_modules: { training_courses: { level_id: 1 } } }], error: null } });
  expect(await S.levelOf(UID)).toBe(1);
});

test('write: upsert on coaching_session_id, returns the stored row; never throws', async () => {
  load({ video_recommendations: { data: { id: 'r9', status: 'none' }, error: null } });
  expect(await S.write({ coaching_session_id: SID, user_id: UID, status: 'none', arm: 'video' })).toEqual({ id: 'r9', status: 'none' });
  expect(db.calls[0]).toContainEqual(['upsert', [{ coaching_session_id: SID, user_id: UID, status: 'none', arm: 'video' }, { onConflict: 'coaching_session_id' }]]);
  load({ video_recommendations: new Error('down') });
  expect(await S.write({ coaching_session_id: SID })).toBeNull();
});

test('markSent: sent_via, wamid and sent_at on the session row (red-team H9: a retry sees it was sent)', async () => {
  load({ video_recommendations: { data: null, error: null } });
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T20:00:00Z'));
  expect(await S.markSent(SID, { sent_via: 'cta_header', wamid: 'wamid.X' })).toBe(true);
  jest.useRealTimers();
  expect(db.calls[0]).toEqual(['video_recommendations',
    ['update', [{ sent_via: 'cta_header', wamid: 'wamid.X', sent_at: '2026-10-20T20:00:00.000Z' }]],
    ['eq', ['coaching_session_id', SID]]]);
});
