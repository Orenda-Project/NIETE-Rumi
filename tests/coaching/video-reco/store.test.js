'use strict';
/**
 * bd-gzfdu9 — store.js (SPEC v1.2.1 §3.6). Every function returns, never throws; a DB error is one warn log and
 * the safe answer.
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
afterEach(() => jest.useRealTimers());

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

test('recentHistory: chapters shown in 365 d (status shown only, v1.3); modules with ≥ 2 chapters in 180 d; one query ≤ 500', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T20:00:00Z'));
  load({ video_recommendations: { data: [
    { seg_id: '3-s2', module_id: 3, created_at: '2026-10-01T00:00:00Z' },
    { seg_id: '3-s4', module_id: 3, created_at: '2026-09-01T00:00:00Z' },
    { seg_id: '9-s1', module_id: 9, created_at: '2026-09-01T00:00:00Z' },
    { seg_id: '7-s1', module_id: 7, created_at: '2026-02-01T00:00:00Z' }, // > 180 d: chapter history only
    { seg_id: '7-s2', module_id: 7, created_at: '2026-01-01T00:00:00Z' },
  ], error: null } });
  expect(await S.recentHistory(UID)).toEqual({ segments: ['3-s2', '3-s4', '9-s1', '7-s1', '7-s2'], modules: [3] });
  const chain = db.calls[0];
  expect(chain).toContainEqual(['eq', ['user_id', UID]]);
  expect(chain).toContainEqual(['gte', ['created_at', '2025-10-20T20:00:00.000Z']]);
  expect(chain).toContainEqual(['not', ['seg_id', 'is', null]]);
  expect(chain).toContainEqual(['limit', [500]]);
});

test('recentHistory: error → empty history', async () => {
  load({ video_recommendations: new Error('x') });
  expect(await S.recentHistory(UID)).toEqual({ segments: [], modules: [] });
});

test('ladderProgress: the Taleemabad ladder only (level ids 1–4); no rows → level null, never a default', async () => {
  load({ teacher_training_progress: { data: [
    { module_id: 5, training_modules: { training_courses: { level_id: 2 } } },
    { module_id: 50, training_modules: { training_courses: { level_id: 3 } } },
    { module_id: 900, training_modules: { training_courses: { level_id: 18 } } }, // another vendor's "English"
    { module_id: 901, training_modules: { training_courses: { level_id: 30 } } }, // the legacy ladder
  ], error: null } });
  expect(await S.ladderProgress(UID)).toEqual({ level: 3, completedModules: [5, 50] });
  expect(db.calls[0]).toContainEqual(['not', ['completed_at', 'is', null]]);
  expect(db.calls[0]).toContainEqual(['limit', [500]]);
  load({ teacher_training_progress: { data: [], error: null } });
  expect(await S.ladderProgress(UID)).toEqual({ level: null, completedModules: [] });
  load({ teacher_training_progress: { data: null, error: { message: 'boom' } } });
  expect(await S.ladderProgress(UID)).toEqual({ level: null, completedModules: [] });
});

test('trainingBands: users.training_bands (H7 grade chain); missing → []', async () => {
  load({ users: { data: { training_bands: ['PRIMARY'] }, error: null } });
  expect(await S.trainingBands(UID)).toEqual(['PRIMARY']);
  expect(db.calls[0]).toEqual(['users', ['select', ['training_bands']], ['eq', ['id', UID]], ['maybeSingle', []]]);
  load({ users: new Error('column does not exist') });
  expect(await S.trainingBands(UID)).toEqual([]);
});

test('write: upsert on coaching_session_id, returns the stored row; never throws', async () => {
  load({ video_recommendations: { data: { id: 'r9', status: 'none' }, error: null } });
  expect(await S.write({ coaching_session_id: SID, user_id: UID, status: 'none', arm: 'video' })).toEqual({ id: 'r9', status: 'none' });
  expect(db.calls[0]).toContainEqual(['upsert', [{ coaching_session_id: SID, user_id: UID, status: 'none', arm: 'video' }, { onConflict: 'coaching_session_id' }]]);
  load({ video_recommendations: new Error('down') });
  expect(await S.write({ coaching_session_id: SID })).toBeNull();
});

test('markSent: sent_via, wamid, sent_at, image_strip (H9: a retry sees it was sent)', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T20:00:00Z'));
  load({ video_recommendations: { data: null, error: null } });
  expect(await S.markSent(SID, { sent_via: 'cta_header', wamid: 'wamid.X', image_strip: true })).toBe(true);
  expect(db.calls[0]).toEqual(['video_recommendations',
    ['update', [{ sent_via: 'cta_header', wamid: 'wamid.X', sent_at: '2026-10-20T20:00:00.000Z', image_strip: true }]],
    ['eq', ['coaching_session_id', SID]]]);
});
