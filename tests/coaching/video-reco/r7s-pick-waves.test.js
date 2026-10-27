'use strict';
/**
 * bd-8hhqhf R7s (COS 20261026T171054 §2; red7 r7s_pick_time_main_9c5e4c4d21 + 171325): the card-mode pick spent its
 * time in serial Supabase round trips — readForSession, then {history, ladder, roster (2 deep)}, then the v10 group
 * (switch, users, arm row), then trainingBands: ~6–7 waves, prod engine_ms p90 1.44 s against the 1.5 s image wait.
 * Every read is keyed by the session and the teacher only, so they go out in one wave; the roster's class read and the
 * v10 arm row are the second. Bar: ≤ 2 serial waits, i.e. the pick takes < 3 × the per-call delay. Nothing that
 * decides the pick changes: the row is the same with a slow store and an instant one.
 * COS 20261027T073937 §1: the timing proofs run on a virtual clock (jest fake timers: Date.now moves only when the test
 * moves it, CPU costs 0 ms), so a wave is read off exact start times and hold at any machine load (the wall-clock bounds
 * failed 9/10 runs at load 21–40).
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const DELAY = 200;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENV = { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_MODE: 'shadow', VIDEO_RECO_REASON: 'card' };

function args() {
  return {
    session: {
      id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [
        { start_ms: 30000, label: 'Teacher', text: 'Is this a triangle? Yes or no, quickly!' },
        { start_ms: 45000, label: 'Student', text: 'Yes' },
      ] },
    },
    // no subject_resolution.grade: the grade comes from trainingBands, the read that used to run last
    analysis: { framework: 'fico', domains: { C: { indicators: [
      { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:30]' },
    ] } }, subject_resolution: { code: 'urdu', confidence: 'high' }, topic: 'shapes' },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    card: { indicator: 'C1', action: 'Ask two why questions about shapes' },
    coachingSessionId: SID,
  };
}

/** Every chain costs `delay` ms; the start time of each is recorded so the serial depth can be read off. */
function slowSupabase(delay, t0) {
  const starts = [];
  const reply = (table, chain) => {
    const has = (m) => chain.some((c) => c[0] === m);
    if (table === 'app_settings') return { data: { key: 'ab_v10_enabled', value: 'true' }, error: null };
    if (table === 'users') return { data: { id: UID, school_id: 'sch-1', teacher_level: 'PRIMARY' }, error: null };
    if (table === 'niete_coaching_ab_assignment') return { data: { school_id: 'sch-1', ab_group: 'C' }, error: null };
    if (table === 'class_teachers') return { data: [{ class_id: 'cls-1' }], error: null };
    if (table === 'student_lists') return { data: [], error: null };
    if (table === 'class_enrollments') return { data: [{ students: { student_name: 'Zarmeena Abbasi' } }], error: null };
    if (table === 'video_recommendations' && has('upsert')) return { data: { id: 'rec-1', ...chain.find((c) => c[0] === 'upsert')[1][0] }, error: null };
    if (table === 'video_recommendations' && has('maybeSingle')) return { data: null, error: null };
    return { data: [], error: null };
  };
  return {
    starts,
    from(table) {
      const chain = [];
      const b = {};
      for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'not', 'in', 'is', 'limit', 'order', 'maybeSingle', 'single', 'upsert', 'update', 'insert']) {
        b[m] = (...a) => { chain.push([m, a]); return b; };
      }
      b.then = (res, rej) => {
        if (!chain.some((c) => c[0] === 'upsert')) starts.push({ table, at: Date.now() - t0 });
        return sleep(delay).then(() => reply(table, chain)).then(res, rej);
      };
      return b;
    },
  };
}

function load(supa) {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => supa);
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  const E = require('../../../bot/shared/services/coaching/video-reco/engine');
  const catalog = require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE);
  return { E, catalog };
}

const strip = (row) => { const { engine_ms: _ms, ...rest } = row || {}; return rest; };

const VIRTUAL = { doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }; // promises and ticks stay real
/** Run `p` to its end on the virtual clock; returns the result and the virtual time it settled at. */
async function settle(p, t0) {
  let at = null;
  const out = p.then((v) => { at = Date.now() - t0; return v; });
  await jest.advanceTimersByTimeAsync(10 * DELAY);
  return { value: await out, at };
}

describe('virtual clock (counts and order, not the machine\'s speed)', () => {
  beforeEach(() => jest.useFakeTimers(VIRTUAL));
  afterEach(() => jest.useRealTimers());

  test('the real store + the real v10 lookup (cold switch cache): the pick reads in ≤ 2 serial waves', async () => {
    const t0 = Date.now();
    const supa = slowSupabase(DELAY, t0);
    const { E, catalog } = load(supa);
    const { value: row } = await settle(E.recommendForReport({ ...args(), deps: { env: ENV, catalog } }), t0);
    expect(row).toMatchObject({ coaching_session_id: SID, v10_group: 'C' });
    // the reads this pick needs all happened (the roster's second step and the arm row included)
    const tables = supa.starts.map((s) => s.table);
    for (const t of ['video_recommendations', 'teacher_training_progress', 'class_teachers', 'class_enrollments', 'app_settings', 'users', 'niete_coaching_ab_assignment']) {
      expect(tables).toContain(t);
    }
    // every read starts exactly at 0 or DELAY (a wave boundary); 2 distinct start times = 2 serial waves
    const waves = new Set(supa.starts.map((s) => s.at));
    expect([...waves].every((at) => at % DELAY === 0)).toBe(true);
    expect(waves.size).toBeLessThanOrEqual(2);
    // engine_ms is what prod measures (stamped before the upsert): the waves' waits and nothing else
    expect(row.engine_ms).toBe(waves.size * DELAY);
  });

  test('injected store and v10 fakes at 200 ms a call (red7 attack_r7s shape): every read starts in the first tick', async () => {
    const t0 = Date.now();
    const starts = [];
    const timed = (name, value) => jest.fn(async () => { starts.push({ name, at: Date.now() - t0 }); await sleep(DELAY); return value; });
    const { E, catalog } = load({ from: () => { throw new Error('no direct supabase here'); } });
    const store = {
      readForSession: timed('readForSession', null),
      recentHistory: timed('recentHistory', { segments: [], modules: [] }),
      ladderProgress: timed('ladderProgress', { level: 2, completedModules: [] }),
      rosterNames: timed('rosterNames', []),
      trainingBands: timed('trainingBands', ['PRIMARY']),
      write: jest.fn(async (r) => ({ id: 'rec-1', ...r })),
    };
    const v10GroupFor = timed('v10GroupFor', { group: 'C' });
    const { value: row, at } = await settle(E.recommendForReport({ ...args(), deps: { env: ENV, catalog, store, v10GroupFor } }), t0);
    expect(row).toMatchObject({ v10_group: 'C' });
    expect(starts.map((s) => s.name).sort()).toEqual(['ladderProgress', 'readForSession', 'recentHistory', 'rosterNames', 'trainingBands', 'v10GroupFor']);
    expect(starts.map((s) => s.at)).toEqual(starts.map(() => 0)); // all at once, before any is back
    expect(at).toBe(DELAY); // one wave; head: 4 waves, ~830 ms
  });

  test('a stored row still wins, as fast as before (one wave), and nothing is written', async () => {
    const t0 = Date.now();
    const write = jest.fn();
    const { E, catalog } = load({ from: () => { throw new Error('no direct supabase here'); } });
    const later = (v) => jest.fn(async () => { await sleep(DELAY); return v; });
    const store = {
      readForSession: jest.fn(async () => { await sleep(DELAY); return { id: 'rec-0', status: 'shadow' }; }),
      recentHistory: later({ segments: [], modules: [] }), ladderProgress: later({ level: null, completedModules: [] }),
      trainingBands: later([]), write,
    };
    const { value, at } = await settle(E.recommendForReport({ ...args(), deps: { env: ENV, catalog, store, v10GroupFor: later(null) } }), t0);
    expect(value).toEqual({ id: 'rec-0', status: 'shadow' });
    expect(at).toBe(DELAY);
    expect(write).not.toHaveBeenCalled();
  });
});

test('pick identity: the slow store and an instant store give the same row (engine_ms aside)', async () => {
  const slow = slowSupabase(DELAY, Date.now());
  let m = load(slow);
  const a = strip(await m.E.recommendForReport({ ...args(), deps: { env: ENV, catalog: m.catalog } }));
  const fast = slowSupabase(0, Date.now());
  m = load(fast);
  const b = strip(await m.E.recommendForReport({ ...args(), deps: { env: ENV, catalog: m.catalog } }));
  expect(a).toEqual(b);
  expect(a.status).toBeTruthy();
});

test('a read that rejects after a stored row returned is not an unhandled rejection', async () => {
  const { E, catalog } = load({ from: () => { throw new Error('no direct supabase here'); } });
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  const store = {
    readForSession: jest.fn().mockResolvedValue({ id: 'rec-0' }),
    recentHistory: jest.fn(async () => { await sleep(20); throw new Error('boom'); }),
    ladderProgress: jest.fn().mockResolvedValue({ level: null, completedModules: [] }),
    trainingBands: jest.fn().mockResolvedValue([]), write: jest.fn(),
  };
  expect(await E.recommendForReport({ ...args(), deps: { env: ENV, catalog, store, v10GroupFor: jest.fn().mockResolvedValue(null) } })).toEqual({ id: 'rec-0' });
  await sleep(60);
  process.removeListener('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
});

describe('ab-v10-arms.groupForEager: groupFor\'s answer, the switch and the school read in one wave', () => {
  const cases = [
    ['switch off', { on: false }],
    ['no school', { school: null }],
    ['school not drawn', { arm: null }],
    ['group B', { arm: 'B' }],
    ['users read error', { usersError: true }],
    ['arm read error', { armError: true }],
  ];
  test.each(cases)('%s → the same as groupFor', async (_, c) => {
    const make = () => ({
      from(table) {
        const b = {};
        for (const m of ['select', 'eq', 'maybeSingle', 'in']) b[m] = () => b;
        b.then = (res, rej) => sleep(5).then(() => {
          if (table === 'app_settings') return { data: { value: c.on === false ? 'false' : 'true' }, error: null };
          if (table === 'users') return c.usersError ? { data: null, error: { message: 'x' } } : { data: { id: UID, school_id: c.school === null ? null : 'sch-1' }, error: null };
          return c.armError ? { data: null, error: { message: 'y' } } : { data: c.arm === null ? null : { school_id: 'sch-1', ab_group: c.arm || 'C' }, error: null };
        }).then(res, rej);
        return b;
      },
    });
    const run = async (fn) => {
      jest.resetModules();
      jest.doMock('../../../bot/shared/config/supabase', make);
      jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
      return require('../../../bot/shared/services/coaching/ab-v10-arms')[fn](UID);
    };
    expect(await run('groupForEager')).toEqual(await run('groupFor'));
  });

  test('cold switch cache: two serial waves, not three (virtual clock)', async () => {
    jest.useFakeTimers(VIRTUAL);
    try {
      const t0 = Date.now();
      const supa = slowSupabase(DELAY, t0);
      jest.resetModules();
      jest.doMock('../../../bot/shared/config/supabase', () => supa);
      jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
      const { value: g, at } = await settle(require('../../../bot/shared/services/coaching/ab-v10-arms').groupForEager(UID), t0);
      expect(g).toMatchObject({ group: 'C' });
      expect(new Set(supa.starts.map((s) => s.at)).size).toBe(2);
      expect(at).toBe(2 * DELAY);
    } finally { jest.useRealTimers(); }
  });
});
