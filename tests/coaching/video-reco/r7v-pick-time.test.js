'use strict';
/**
 * bd-8hhqhf R7v (COS 20261027T050735; eng-fix r7v/MEASURE.md): the card-mode pick, p90 ≤ 600 ms at school-day peak on prod.
 * R7s left two serial read waves (~600 ms at the peak RTT on their own: the hole:no_move rows) plus CPU the pick rebuilt on
 * every call (the redactor's vocab sets per transcript line, the BM25 catalogue index per call).
 * (1) The report starts the reads at its own start (prefetchReads); at an RTT of 250 ms (the peak figure) the pick then waits
 *     for no read at all. (2) The row is the same with and without the prefetch. (The static work, parts b–d, is r7v-cpu.test.js.)
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const RTT = 250;
const BAR = 600;
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
    analysis: { framework: 'fico', domains: { C: { indicators: [
      { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:30]' },
    ] } }, subject_resolution: { code: 'urdu', confidence: 'high' }, topic: 'shapes' },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    card: { indicator: 'C1', action: 'Ask two why questions about shapes' },
    coachingSessionId: SID,
  };
}

/** The real store + the real v10 lookup over a Supabase whose every call costs `delay` ms; counts the reads. */
function slowSupabase(delay, { stored = null } = {}) {
  const reads = [];
  const reply = (table, chain) => {
    const has = (m) => chain.some((c) => c[0] === m);
    if (table === 'app_settings') return { data: { key: 'ab_v10_enabled', value: 'true' }, error: null };
    if (table === 'users') return { data: { id: UID, school_id: 'sch-1', teacher_level: 'PRIMARY' }, error: null };
    if (table === 'niete_coaching_ab_assignment') return { data: { school_id: 'sch-1', ab_group: 'C' }, error: null };
    if (table === 'class_teachers') return { data: [{ class_id: 'cls-1' }], error: null };
    if (table === 'student_lists') return { data: [], error: null };
    if (table === 'class_enrollments') return { data: [{ students: { student_name: 'Zarmeena Abbasi' } }], error: null };
    if (table === 'teacher_training_progress') return { data: [], error: null };
    if (table === 'video_recommendations' && has('upsert')) return { data: { id: 'rec-1', ...chain.find((c) => c[0] === 'upsert')[1][0] }, error: null };
    if (table === 'video_recommendations' && has('maybeSingle')) return { data: stored, error: null };
    return { data: [], error: null };
  };
  return {
    reads,
    from(table) {
      const chain = [];
      const b = {};
      for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'not', 'in', 'is', 'limit', 'order', 'maybeSingle', 'single', 'upsert', 'update', 'insert']) {
        b[m] = (...a) => { chain.push([m, a]); return b; };
      }
      b.then = (res, rej) => {
        if (!chain.some((c) => c[0] === 'upsert')) reads.push(table);
        return sleep(delay).then(() => reply(table, chain)).then(res, rej);
      };
      return b;
    },
  };
}

function load(supa) {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => supa);
  const log = jest.fn();
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: log, logWarn: jest.fn() }));
  const E = require('../../../bot/shared/services/coaching/video-reco/engine');
  const catalog = require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE);
  return { E, catalog, log };
}
const strip = (row) => { const { engine_ms: _ms, ...rest } = row || {}; return rest; };
/** prefetch → the report's own work (≥ 2 RTT, as topic + subject + card take on prod) → the pick. */
async function reportThenPick(supa, { prefetch = true, work = 3 * RTT, a = args() } = {}) {
  const { E, catalog, log } = load(supa);
  const deps = { env: ENV, catalog };
  if (prefetch && typeof E.prefetchReads === 'function') E.prefetchReads({ session: a.session, coachingSessionId: a.coachingSessionId, analysis: a.analysis, deps: { env: ENV } });
  await sleep(work);
  const t0 = Date.now();
  const row = await E.recommendForReport({ ...a, deps });
  const timing = (log.mock.calls.find((c) => c[0] === '[video-reco] timing') || [])[1] || null;
  return { row, wall: Date.now() - t0, E, timing };
}

test(`RTT ${RTT} ms (peak): with the report's prefetch, the pick waits for no read and lands under the ${BAR} ms bar`, async () => {
  const supa = slowSupabase(RTT);
  const { row, timing } = await reportThenPick(supa);
  expect(row).toMatchObject({ coaching_session_id: SID, v10_group: 'C' });
  // the pick's own timing line: no read waited for (head: 2 waves, ~500 ms, 657 ms measured), and under the bar
  expect(timing).toMatchObject({ prefetched: true });
  expect(timing.reads_wait_ms).toBeLessThan(50);
  expect(row.engine_ms).toBeLessThan(BAR);
});

test('the reads went out once, at the prefetch: the pick issued none of its own', async () => {
  const supa = slowSupabase(RTT);
  const { E, catalog } = load(supa);
  const a = args();
  expect(E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: a.analysis, deps: { env: ENV } })).toBe(true);
  await sleep(3 * RTT);
  const atPick = supa.reads.length;
  expect(atPick).toBeGreaterThan(0);
  await E.recommendForReport({ ...a, deps: { env: ENV, catalog } });
  expect(supa.reads.length).toBe(atPick);
});

test('pick identity: the prefetched row = the row without a prefetch (engine_ms aside), through the real store', async () => {
  const a = strip((await reportThenPick(slowSupabase(RTT))).row);
  const b = strip((await reportThenPick(slowSupabase(RTT), { prefetch: false, work: 0 })).row);
  expect(a).toEqual(b);
  expect(a.status).toBeTruthy();
});

test('pick identity without a grade on the analysis: the bands read by the prefetch decide exactly as the pick\'s own read', async () => {
  const noGrade = () => { const x = args(); delete x.analysis.subject_resolution; return x; };
  const a = strip((await reportThenPick(slowSupabase(5), { a: noGrade(), work: 50 })).row);
  const b = strip((await reportThenPick(slowSupabase(5), { a: noGrade(), prefetch: false, work: 0 })).row);
  expect(a).toEqual(b);
});

test('a prefetch that is still in flight is awaited, not re-issued', async () => {
  const supa = slowSupabase(RTT);
  const { row } = await reportThenPick(supa, { work: RTT / 2 });
  expect(row).toMatchObject({ coaching_session_id: SID });
  // only what is left of the 2 waves (≈ 1.5 RTT) is waited for; head waits the full 2 waves (≥ 2 RTT) from the call
  expect(row.engine_ms).toBeLessThan(2 * RTT - 50);
  const counts = supa.reads.reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {});
  expect(counts.video_recommendations).toBe(2); // the stored-row read and the history read, once each
  expect(counts.teacher_training_progress).toBe(1);
});

test('a stored row found by the prefetch still wins, and nothing is written', async () => {
  const supa = slowSupabase(RTT, { stored: { id: 'rec-0', status: 'shadow' } });
  const { row } = await reportThenPick(supa);
  expect(row).toEqual({ id: 'rec-0', status: 'shadow' });
});

test('a prefetch is used once, and only for its own teacher and store', () => {
  const supa = slowSupabase(0);
  const { E, catalog } = load(supa);
  const a = args();
  expect(E.prefetchReads({ session: { ...a.session, user_id: 'someone-else' }, coachingSessionId: SID, analysis: a.analysis, deps: { env: ENV } })).toBe(true);
  return E.recommendForReport({ ...a, deps: { env: ENV, catalog } }).then(async (row) => {
    expect(row).toMatchObject({ user_id: UID });
    // the mismatched prefetch was dropped; this pick read for itself
    expect(supa.reads.filter((t) => t === 'teacher_training_progress').length).toBe(2);
    const n = supa.reads.length;
    await E.recommendForReport({ ...a, coachingSessionId: 'other-session', deps: { env: ENV, catalog } });
    expect(supa.reads.length).toBeGreaterThan(n);
  });
});

test('red7 N1: no analysis (null/undefined) → no prefetch, as the pick refuses it; nothing is read', () => {
  const supa = slowSupabase(0);
  const { E } = load(supa);
  const a = args();
  expect(E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: null, deps: { env: ENV } })).toBe(false);
  expect(E.prefetchReads({ session: a.session, coachingSessionId: SID, deps: { env: ENV } })).toBe(false);
  expect(E._prefetchSize()).toBe(0);
  return new Promise((r) => setTimeout(r, 10)).then(() => expect(supa.reads).toEqual([]));
});

test('flag off or not FICO: the prefetch reads nothing', () => {
  const supa = slowSupabase(0);
  const { E } = load(supa);
  const a = args();
  expect(E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: a.analysis, deps: { env: {} } })).toBe(false);
  expect(E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: { framework: 'oecd' }, deps: { env: ENV } })).toBe(false);
  expect(E.prefetchReads({ coachingSessionId: SID, deps: { env: ENV } })).toBe(false);
  expect(supa.reads).toEqual([]);
});

describe('report-path safety (COS 20261027T055344 §1)', () => {
  test('a prefetch whose store throws or rejects never throws, leaves nothing unhandled, and the pick reads afresh', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const { E, catalog } = load({ from: () => { throw new Error('no direct supabase here'); } });
    const a = args();
    const ok = (v) => jest.fn(async () => v);
    let down = true;
    const flaky = (v) => jest.fn(async () => { if (down) throw new Error('store down'); return v; });
    const store = {
      readForSession: flaky(null), recentHistory: flaky({ segments: [], modules: [] }), ladderProgress: flaky({ level: 2, completedModules: [] }),
      rosterNames: jest.fn(() => { if (down) throw new Error('sync throw'); return Promise.resolve([]); }), trainingBands: ok([]),
      write: jest.fn(async (r) => ({ id: 'rec-1', ...r })),
    };
    expect(() => E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: a.analysis, deps: { env: ENV, store, v10GroupFor: ok(null) } })).not.toThrow();
    const store2 = { ...store, rosterNames: ok([]) };
    expect(E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: a.analysis, deps: { env: ENV, store: store2, v10GroupFor: ok(null) } })).toBe(true);
    await sleep(20);
    down = false; // the store is back by the time the pick runs
    const row = await E.recommendForReport({ ...a, deps: { env: ENV, catalog, store: store2, v10GroupFor: ok(null) } });
    expect(row).toMatchObject({ coaching_session_id: SID, user_id: UID });
    expect(row.status).not.toBe('error');
    await sleep(20);
    process.removeListener('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test('a bad session (no user, no id) or a throwing deps getter: prefetchReads returns false, never throws', () => {
    const { E } = load(slowSupabase(0));
    expect(E.prefetchReads()).toBe(false);
    expect(E.prefetchReads({ session: null, coachingSessionId: SID, deps: { env: ENV } })).toBe(false);
    expect(E.prefetchReads({ session: { user_id: UID }, deps: { env: ENV } })).toBe(false);
    const evil = { session: { user_id: UID }, coachingSessionId: SID, get deps() { throw new Error('getter'); } };
    expect(E.prefetchReads(evil)).toBe(false);
  });

  test('prefetchReads returns at once, before any read is back (the report never waits on it), even at a 2 s RTT', () => {
    const { E } = load(slowSupabase(2000));
    const a = args();
    const t0 = Date.now();
    expect(E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: a.analysis, deps: { env: ENV } })).toBe(true);
    expect(Date.now() - t0).toBeLessThan(50);
    return sleep(2100); // let the slow reads settle inside the test
  });

  test('concurrent reports on one worker: each pick gets its own teacher\'s reads', async () => {
    const perUser = (uid) => ({
      readForSession: jest.fn(async () => null),
      recentHistory: jest.fn(async (u) => { await sleep(30); return { segments: [], modules: [], who: u }; }),
      ladderProgress: jest.fn(async (u) => { await sleep(30); return { level: u === 'u-A' ? 1 : 4, completedModules: [] }; }),
      rosterNames: jest.fn(async () => []), trainingBands: jest.fn(async () => []),
      write: jest.fn(async (r) => ({ id: `rec-${uid}`, ...r })),
    });
    const { E, catalog } = load({ from: () => { throw new Error('no direct supabase here'); } });
    const store = perUser();
    const v10 = jest.fn(async () => null);
    const mk = (uid, sid) => { const a = args(); a.session = { ...a.session, user_id: uid, id: sid }; a.coachingSessionId = sid; return a; };
    const A = mk('u-A', 'sess-A'); const B = mk('u-B', 'sess-B');
    E.prefetchReads({ session: A.session, coachingSessionId: 'sess-A', analysis: A.analysis, deps: { env: ENV, store, v10GroupFor: v10 } });
    E.prefetchReads({ session: B.session, coachingSessionId: 'sess-B', analysis: B.analysis, deps: { env: ENV, store, v10GroupFor: v10 } });
    const [ra, rb] = await Promise.all([
      E.recommendForReport({ ...A, deps: { env: ENV, catalog, store, v10GroupFor: v10 } }),
      E.recommendForReport({ ...B, deps: { env: ENV, catalog, store, v10GroupFor: v10 } }),
    ]);
    expect(ra).toMatchObject({ user_id: 'u-A', coaching_session_id: 'sess-A', teacher_level: 1 });
    expect(rb).toMatchObject({ user_id: 'u-B', coaching_session_id: 'sess-B', teacher_level: 4 });
    // a pick for sess-A by another teacher (a reused session id) never takes A's prefetch
    E.prefetchReads({ session: A.session, coachingSessionId: 'sess-X', analysis: A.analysis, deps: { env: ENV, store, v10GroupFor: v10 } });
    const rx = await E.recommendForReport({ ...mk('u-B', 'sess-X'), deps: { env: ENV, catalog, store, v10GroupFor: v10 } });
    expect(rx).toMatchObject({ user_id: 'u-B', teacher_level: 4 });
  });

  test('bounded: at most 200 entries; an entry older than 5 min is swept and never used', async () => {
    const supa = slowSupabase(0);
    const { E, catalog } = load(supa);
    const a = args();
    for (let i = 0; i < 260; i += 1) E.prefetchReads({ session: a.session, coachingSessionId: `s-${i}`, analysis: a.analysis, deps: { env: ENV } });
    expect(E._prefetchSize()).toBe(200);
    E.prefetchReads({ session: a.session, coachingSessionId: SID, analysis: a.analysis, deps: { env: ENV } });
    await sleep(10);
    const real = Date.now;
    const later = real() + 5 * 60000 + 5;
    Date.now = () => later;
    try {
      const before = supa.reads.length;
      await E.recommendForReport({ ...a, deps: { env: ENV, catalog } }); // its prefetch is stale: read afresh
      expect(supa.reads.length).toBeGreaterThan(before);
      E.prefetchReads({ session: a.session, coachingSessionId: 'fresh', analysis: a.analysis, deps: { env: ENV } });
      expect(E._prefetchSize()).toBe(1); // every stale entry swept
    } finally { Date.now = real; }
    await sleep(10);
  });
});
