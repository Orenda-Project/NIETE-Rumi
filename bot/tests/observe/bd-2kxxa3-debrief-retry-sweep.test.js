/**
 * bd-2kxxa.3 — selectDebriefsToRetry truth table.
 *
 * The pure half of the self-heal sweep: given the narrow projection the worker
 * pulls (id, debrief_status, created_at, observer_debrief), decide which stuck
 * debrief recordings get re-queued. No DB, no Redis, no clock — everything is
 * injected so each rule is one assertion.
 */

const { selectDebriefsToRetry, MAX_ATTEMPTS } = require('../../shared/services/observe/debrief-retry-sweep');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-03T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const row = (debriefOver = {}, over = {}) => ({
  id: over.id || `s-${Math.random().toString(36).slice(2, 8)}`,
  debrief_status: 'pending',
  created_at: iso(3 * HOUR),
  observer_debrief: {
    audio_id: 'wamid.A', recorded_at: iso(2 * HOUR), transcript: null, feedback: null,
    ...debriefOver,
  },
  ...over,
});

const ids = (rows) => rows.map((r) => r.id);

describe('T2 · selectDebriefsToRetry', () => {
  test('the eligible shape: pending + audio_id + no transcript + old enough + attempts under max + inside age ceiling → returned', () => {
    const r = row({}, { id: 'eligible' });
    expect(ids(selectDebriefsToRetry([r], NOW))).toEqual(['eligible']);
  });

  test('too young: recorded < minAgeMinutes ago → skipped (it may still be mid-flight)', () => {
    const r = row({ recorded_at: iso(10 * MIN) });
    expect(selectDebriefsToRetry([r], NOW, { minAgeMinutes: 30 })).toEqual([]);
    // …and eligible again once the window has passed
    expect(selectDebriefsToRetry([r], NOW + 25 * MIN, { minAgeMinutes: 30 })).toHaveLength(1);
  });

  test('a recent FAILURE also resets the clock: failed_at 5 min ago → skipped even if recorded hours ago', () => {
    const r = row({ recorded_at: iso(5 * HOUR), failed_at: iso(5 * MIN), attempts: 1 });
    expect(selectDebriefsToRetry([r], NOW)).toEqual([]);
    expect(selectDebriefsToRetry([r], NOW + 30 * MIN)).toHaveLength(1);
  });

  test('attempts ≥ maxAttempts → skipped (default max is exported and equals 6)', () => {
    expect(MAX_ATTEMPTS).toBe(6);
    expect(selectDebriefsToRetry([row({ attempts: 6, failed_at: iso(2 * HOUR) })], NOW)).toEqual([]);
    expect(selectDebriefsToRetry([row({ attempts: 9, failed_at: iso(2 * HOUR) })], NOW)).toEqual([]);
    expect(selectDebriefsToRetry([row({ attempts: 5, failed_at: iso(2 * HOUR) })], NOW)).toHaveLength(1);
    // the option overrides the default
    expect(selectDebriefsToRetry([row({ attempts: 2, failed_at: iso(2 * HOUR) })], NOW, { maxAttempts: 2 })).toEqual([]);
  });

  test('older than maxAgeDays (Meta media expires ~30 days) → skipped', () => {
    const r = row({ recorded_at: iso(29 * DAY) }, { created_at: iso(29 * DAY) });
    expect(selectDebriefsToRetry([r], NOW, { maxAgeDays: 28 })).toEqual([]);
    const r2 = row({ recorded_at: iso(27 * DAY) }, { created_at: iso(27 * DAY) });
    expect(selectDebriefsToRetry([r2], NOW, { maxAgeDays: 28 })).toHaveLength(1);
  });

  test('has a transcript → skipped (transcription already succeeded; LLM/feedback failures are bd-b5elb\'s lane)', () => {
    expect(selectDebriefsToRetry([row({ transcript: 'FO: hello. Teacher: hi.' })], NOW)).toEqual([]);
  });

  test('no audio_id → skipped (coach chose "later" and never recorded — nothing to retry)', () => {
    expect(selectDebriefsToRetry([row({ audio_id: null })], NOW)).toEqual([]);
    expect(selectDebriefsToRetry([row({ audio_id: undefined })], NOW)).toEqual([]);
  });

  test('not pending → skipped, whatever else the blob says', () => {
    expect(selectDebriefsToRetry([row({}, { debrief_status: 'done' })], NOW)).toEqual([]);
    expect(selectDebriefsToRetry([row({}, { debrief_status: 'skipped' })], NOW)).toEqual([]);
  });

  test('no recorded_at (older rows) → falls back to created_at for both age rules', () => {
    const r = row({ recorded_at: undefined }, { created_at: iso(2 * HOUR) });
    expect(selectDebriefsToRetry([r], NOW)).toHaveLength(1);
    const young = row({ recorded_at: undefined }, { created_at: iso(5 * MIN) });
    expect(selectDebriefsToRetry([young], NOW)).toEqual([]);
    const ancient = row({ recorded_at: undefined }, { created_at: iso(40 * DAY) });
    expect(selectDebriefsToRetry([ancient], NOW)).toEqual([]);
  });

  test('accepts the raw analysis_data shape too, and tolerates garbage rows', () => {
    const nested = { id: 'nested', debrief_status: 'pending', created_at: iso(3 * HOUR),
      analysis_data: { observer_debrief: { audio_id: 'wamid.B', recorded_at: iso(2 * HOUR) } } };
    expect(ids(selectDebriefsToRetry([nested], NOW))).toEqual(['nested']);
    expect(selectDebriefsToRetry([null, undefined, {}, { debrief_status: 'pending' }], NOW)).toEqual([]);
    expect(selectDebriefsToRetry(null, NOW)).toEqual([]);
  });

  test('order is preserved (the worker orders oldest-first at the query)', () => {
    const a = row({}, { id: 'a' });
    const b = row({}, { id: 'b' });
    expect(ids(selectDebriefsToRetry([a, b], NOW))).toEqual(['a', 'b']);
  });
});
