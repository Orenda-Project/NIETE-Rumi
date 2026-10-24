'use strict';
/**
 * bd-8hhqhf R7n (promo 20261024T191116, red7 191357/191815, COS 191154 §1; BLOCKER for the card-mode shadow): V1.7.2
 * has `CHECK (attempts IS NULL OR attempts IN (1, 2))` and V1.7.1 `CHECK (route IN ('tag','step_text','card_text'))`,
 * but the engine writes attempts 0 on every no-call pick (card mode, the R7f fixed paths), 3–4 when the second moment
 * runs, and route 'enacted' / 'closure' on the fixed paths. store.write caught the 23514 and returned null, so those
 * pick rows were lost. The store is the one place every row reaches the table: outside the allowed set → NULL.
 * Both CHECKs are read from the migration files themselves, so the test and the schema cannot drift apart.
 */
const fs = require('fs');
const path = require('path');
const { fakeSupabase } = require('./fixtures/fake-supabase');
const FIXTURE = require('./fixtures/catalog.fixture.json');

const MIGRATIONS = path.join(__dirname, '../../../infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const ALLOWED = (() => {
  const m = /attempts SMALLINT\s+CHECK \(attempts IS NULL OR attempts IN \(([\d,\s]+)\)\)/.exec(read('V1.7.2__video_recommendations_retry.sql'));
  if (!m) throw new Error('V1.7.2 attempts CHECK not found');
  return new Set(m[1].split(',').map((x) => Number(x.trim())));
})();
const ROUTES = (() => {
  const m = /route TEXT\s+CHECK \(route IN \(([^)]+)\)\)/.exec(read('V1.7.1__video_reco_retrieval_route.sql'));
  if (!m) throw new Error('V1.7.1 route CHECK not found');
  return new Set(m[1].split(',').map((x) => x.trim().replace(/'/g, '')));
})();
// a NULL passes a CHECK (SQL: unknown is not false)
const passesCheck = (row) => (row.attempts == null || ALLOWED.has(row.attempts)) && (row.route == null || ROUTES.has(row.route));

let db;
let S;
let E;
let C;
beforeEach(() => {
  jest.resetModules();
  db = fakeSupabase({ video_recommendations: (chain) => ({ data: (chain.find((c) => c[0] === 'upsert') || [, [{}]])[1][0], error: null }) });
  jest.doMock('../../../bot/shared/config/supabase', () => db);
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  S = require('../../../bot/shared/services/coaching/video-reco/store');
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
});
const upserted = () => db.calls.filter((c) => c[0] === 'video_recommendations').map((c) => (c.find((x) => x[0] === 'upsert') || [])[1]).filter(Boolean).map((a) => a[0]);

test('the CHECKs this test mirrors: V1.7.2 attempts {1, 2}, V1.7.1 route {tag, step_text, card_text}', () => {
  expect([...ALLOWED].sort()).toEqual([1, 2]);
  expect([...ROUTES].sort()).toEqual(['card_text', 'step_text', 'tag']);
});

describe('store.write sends only what the attempts CHECK allows', () => {
  test.each([[0, null], [3, null], [4, null], [1, 1], [2, 2], [null, null]])('attempts %p → %p', async (given, stored) => {
    const out = await S.write({ coaching_session_id: 's1', user_id: 'u1', status: 'shadow', attempts: given });
    expect(upserted()[0].attempts).toBe(stored);
    expect(passesCheck(upserted()[0])).toBe(true);
    expect(out).not.toBeNull();
  });
  test.each([['enacted', null], ['closure', null], ['tag', 'tag'], ['step_text', 'step_text'], ['card_text', 'card_text'], [null, null]])('route %p → %p; candidates keep the real route', async (given, stored) => {
    const candidates = [{ seg_id: '51-s1', route: given }];
    await S.write({ coaching_session_id: 's1', user_id: 'u1', status: 'shown', route: given, attempts: 1, candidates });
    expect(upserted()[0].route).toBe(stored);
    expect(upserted()[0].candidates).toEqual(candidates);
    expect(passesCheck(upserted()[0])).toBe(true);
  });
  test.each([[{ coaching_session_id: 's1', user_id: null }], [{ coaching_session_id: null, user_id: 'u1' }]])('NOT NULL ids: %p is refused before the DB, with one warn', async (ids) => {
    expect(await S.write({ ...ids, status: 'none', arm: 'video' })).toBeNull();
    expect(upserted()).toHaveLength(0);
  });
  test('a row with no attempts key (the error row) is sent unchanged', async () => {
    const row = { coaching_session_id: 's1', user_id: 'u1', status: 'error', none_reason: 'error:Error' };
    await S.write(row);
    expect(upserted()[0]).toEqual(row);
  });
});

const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const LINES = [
  T('00:20', 'Teacher', 'آج ہم پانی کے بارے میں بات کریں گے اور سب دھیان سے سنیں'), T('00:30', 'Teacher', 'پانی کہاں سے آتا ہے؟'),
  T('00:33', 'Student', 'جی پانی بادل سے آتا ہے'), T('00:36', 'Teacher', 'اور کہاں سے آتا ہے؟'), T('00:39', 'Student', 'دریا سے'),
  T('00:42', 'Teacher', 'ٹھیک ہے بچو، اور کون بتائے گا؟'), T('00:45', 'Student', 'جی'),
];
const WHY = "After a one-word answer, ask 'why do you think so?' and wait five seconds.";

test('card mode end to end: the engine\'s pick row reaches the table through the real store.write and passes the CHECK', async () => {
  const cj = jest.fn();
  const stored = await E.recommendForReport({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' }, diarization_data: { segments: LINES } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "اور کہاں سے آتا ہے؟"', timestamp: '[00:36]' }] } }, subject_resolution: { code: 'science', grade: '3', confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: WHY } }, card: { indicator: 'C1', action: WHY }, coachingSessionId: 's1',
    deps: {
      env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_MODE: 'shadow', VIDEO_RECO_REASON: 'card' },
      catalog: C.fromData(FIXTURE),
      store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], rosterNames: async () => [], write: S.write },
      v10GroupFor: async () => null,
      completeJson: cj,
    },
  });
  expect(cj).not.toHaveBeenCalled();
  const rows = upserted();
  expect(rows).toHaveLength(1);
  expect(rows[0].seg_id).toBeTruthy(); // a pick, not a silence
  expect(rows[0].first_none_reason).toBe('card_mode');
  expect(passesCheck(rows[0])).toBe(true);
  expect(rows[0].attempts).toBeNull();
  expect(stored).not.toBeNull();
});
