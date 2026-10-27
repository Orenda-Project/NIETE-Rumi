'use strict';
/** Stage 0 reads: the teacher key (same bytes as the routes' codec), the governed population, the JSON-path select. */
const crypto = require('crypto');
const src = require('../../lib/insights/source');

const SECRET = 'f'.repeat(64);
const T1 = '00000000-0000-4000-8000-020000000001';

describe('teacherKey', () => {
  test('hex(HMAC-SHA256(secret, "coachip-teacher|" + id))[0:16], 16 hex', () => {
    const want = crypto.createHmac('sha256', SECRET).update(`coachip-teacher|${T1}`).digest('hex').slice(0, 16);
    expect(src.teacherKey(SECRET, T1)).toBe(want);
    expect(src.teacherKey(SECRET, T1)).toMatch(/^[0-9a-f]{16}$/);
  });
  test('a secret under 32 bytes or no id → null, never an unkeyed hash', () => {
    expect(src.teacherKey('short', T1)).toBe(null);
    expect(src.teacherKey(SECRET, '')).toBe(null);
  });
  test('equals the routes\' teacherKeyFor when that module is present (after the m-api merge)', () => {
    let codes = null;
    try { codes = require('../../services/coachip-codes.service'); } catch (_) { codes = null; }
    if (!codes) return;
    for (let i = 1; i <= 20; i += 1) {
      const id = `00000000-0000-4000-8000-02${String(i).padStart(10, '0')}`;
      expect(src.teacherKey(SECRET, id)).toBe(codes.teacherKeyFor(SECRET, id));
    }
  });
});

describe('inPopulation (coaching-query-rules §1)', () => {
  const scope = { teachers: new Map([['t1', 's1']]), testUsers: new Set(['obsTest']) };
  const s = (o) => ({ user_id: 't1', observer_user_id: null, observation_type: null, status: 'completed', ...o });
  test.each([
    [s({}), true],
    [s({ status: 'test_cleanup' }), false],
    [s({ user_id: 'other' }), false],
    [s({ observation_type: 'leader_observation', observer_user_id: 'c1' }), true],
    [s({ observation_type: 'leader_observation', observer_user_id: 'c1', status: 'abandoned' }), false],
    [s({ observation_type: 'leader_observation', observer_user_id: 'obsTest' }), false],
    [s({ observation_type: 'leader_observation', observer_user_id: 't1' }), false],
    [s({ observation_type: 'peer' }), false],
  ])('%#', (row, want) => { expect(src.inPopulation(row, scope)).toBe(want); });
});

describe('the select never names a never-read key', () => {
  test('only allow-listed analysis_data paths', () => {
    const paths = src.SESSION_SELECT.split(',').filter((c) => c.includes('analysis_data'));
    expect(paths.sort()).toEqual(['domains:analysis_data->domains', 'framework:analysis_data->framework', 'lp:analysis_data->lp_fidelity',
      'rubric:analysis_data->observe2->rubric', 'subject:analysis_data->subject'].sort());
    expect(src.SESSION_SELECT).not.toMatch(/transcript|name|phone|executive|notable|teacher_delivery|focus_area/);
  });
  test('analysisOf rebuilds only those keys', () => {
    expect(src.analysisOf({ lp: { status: 'ok' }, domains: null, framework: 'fico', subject: null, rubric: 'fico17' }))
      .toEqual({ lp_fidelity: { status: 'ok' }, framework: 'fico', observe2: { rubric: 'fico17' } });
    expect(src.analysisOf({})).toBe(null);
  });
  test('karachiBounds: Karachi days to UTC', () => {
    expect(src.karachiBounds('2026-09-28', '2026-10-25')).toEqual({ start: '2026-09-27T19:00:00.000Z', end: '2026-10-25T19:00:00.000Z' });
  });
});
