'use strict';

/**
 * The session row keeps the session's start (session_start) and its sound check (audio_check: { heard, tries }), so the
 * sound check's pass, its wrong taps and the time it took can be read from the row. The engine logs one audio_check per
 * try and nothing after a pass, and tries counts up, so the LATEST row is the pass (or the last miss of a child who never
 * passed). Per attempt (a coach's Restart test moves the ended attempt below one `restart` row): the earliest
 * session_start and the latest audio_check, inside the session's existing cap of kept events.
 */

const mockPatches = [];
let mockRow;
jest.mock('../../shared/config/supabase', () => {
  const q = (table) => {
    const blocks = table !== 'child_test_sessions';
    const c = {
      select: () => c, eq: () => c, is: () => c,
      limit: () => Promise.resolve({ data: blocks ? [] : [mockRow], error: null }),
      then: (res, rej) => Promise.resolve({ data: blocks ? [] : [mockRow], error: null }).then(res, rej),
      update: (p) => {
        mockPatches.push({ table, p });
        if (p.device) mockRow = { ...mockRow, device: p.device };
        const done = { eq: () => done, is: () => done, then: (res, rej) => Promise.resolve({ error: null }).then(res, rej) };
        return done;
      },
    };
    return c;
  };
  return { from: (t) => q(t) };
});

const store = require('../../shared/services/child-test/sa-store');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';

function deps() {
  const session = { id: 's1', coach_user_id: COACH, school_id: SCHOOL, item_bank_version: 'sa-battery', status: 'in_progress', device: mockRow.device };
  return {
    enabled: async () => true,
    supabase: { from: () => ({ select() { return this; }, eq() { return this; }, in() { return this; }, limit() { return this; }, then: (res) => Promise.resolve({ data: [{ school_id: SCHOOL, school_name: 'Testwala School' }], error: null }).then(res) }) },
    store: { getSession: async () => ({ ok: true, session }), recordTiming: async () => ({ ok: true }), setSessionStatus: async () => ({ ok: true }) },
    saStore: store,
    now: () => new Date('2026-11-18T09:00:00Z'), log: () => {}, logError: () => {},
  };
}

const batch = (events) => sa.saBatch({
  userId: COACH, sessionId: 's1', seqFrom: events[0].seq, seqTo: events[events.length - 1].seq, events, results: [],
}, deps());
const rowOf = (type) => (mockRow.device.events || []).filter((e) => e.type === type);

beforeEach(() => {
  mockPatches.length = 0;
});

const AC = (seq, heard, tries, at) => ({ seq, type: 'audio_check', at, value: { heard, tries } });
const START = (seq, at) => ({ seq, type: 'session_start', at, value: { battery_id: 'b-1', tasks: 6 } });

describe.each(['rdf_auto', 'rdf_manual'])('%s: the session row keeps the start and the sound check', (block) => {
  beforeEach(() => {
    mockRow = { id: 's1', admin_mode: 'coach_present', device: { block }, client_started_at: null, client_finished_at: null };
  });

  test('(i) one batch, a miss then a pass: the row keeps the pass { heard: true, tries: 2 } and the start', async () => {
    const start = { battery_id: 'b-1', tasks: 6, ...(block === 'rdf_manual' ? { admin_mode: 'manual' } : {}) };
    const out = await batch([
      { seq: 1, type: 'session_start', at: '2026-11-18T08:58:00Z', value: start },
      AC(2, false, 1, '2026-11-18T08:58:09Z'),
      AC(3, true, 2, '2026-11-18T08:58:21Z'),
    ]);
    expect(out).toEqual({ status: 'ok', ackedTo: 3 });
    expect(rowOf('session_start')).toEqual([{ seq: 1, type: 'session_start', task_id: null, at: '2026-11-18T08:58:00Z', data: start }]);
    expect(rowOf('audio_check')).toEqual([{ seq: 3, type: 'audio_check', task_id: null, at: '2026-11-18T08:58:21Z', data: { heard: true, tries: 2 } }]);
  });

  test('(ii) the miss in one batch, the pass in the next: the row holds only the pass', async () => {
    await batch([START(1, '2026-11-18T08:58:00Z'), AC(2, false, 1, '2026-11-18T08:58:09Z')]);
    expect(rowOf('audio_check').map((e) => e.data)).toEqual([{ heard: false, tries: 1 }]);
    await batch([AC(3, true, 2, '2026-11-18T08:58:21Z')]);
    expect(rowOf('audio_check')).toEqual([{ seq: 3, type: 'audio_check', task_id: null, at: '2026-11-18T08:58:21Z', data: { heard: true, tries: 2 } }]);
  });

  test('(iii) three misses, never a pass: the row keeps the last { heard: false, tries: 3 }', async () => {
    await batch([START(1, '2026-11-18T08:58:00Z'), AC(2, false, 1, '2026-11-18T08:58:09Z'), AC(3, false, 2, '2026-11-18T08:58:19Z')]);
    await batch([AC(4, false, 3, '2026-11-18T08:58:29Z')]);
    expect(rowOf('audio_check').map((e) => ({ seq: e.seq, ...e.data }))).toEqual([{ seq: 4, heard: false, tries: 3 }]);
  });

  test('(iv) the start stays the earliest: seq 1, whatever comes later', async () => {
    await batch([START(1, '2026-11-18T08:58:00Z'), AC(2, true, 1, '2026-11-18T08:58:09Z')]);
    await batch([START(3, '2026-11-18T08:59:10Z'), AC(4, true, 2, '2026-11-18T08:59:20Z')]);
    expect(rowOf('session_start').map((e) => e.seq)).toEqual([1]);
    expect(rowOf('audio_check').map((e) => e.seq)).toEqual([4]);
  });

  test('(v) a coach restart: each attempt keeps its own start and its own latest sound check; the restart row stays', async () => {
    // attempt 1: a start and one miss, then the coach restarts the child (the store moves these rows below `restart`)
    await batch([START(1, '2026-11-18T08:58:00Z'), AC(2, false, 1, '2026-11-18T08:58:09Z')]);
    const r = await store.restartAttempt('s1', { clientSessionId: 'phone-2', at: '2026-11-18T09:00:00Z' });
    expect(r).toEqual({ ok: true, attempt: 1 });
    // attempt 2: the phone's seqs start again at 0; a start, a miss, then a pass
    await batch([START(0, '2026-11-18T09:00:05Z'), AC(1, false, 1, '2026-11-18T09:00:14Z'), AC(2, true, 2, '2026-11-18T09:00:26Z')]);
    const ev = mockRow.device.events.map((e) => ({ seq: e.seq, type: e.type, ...(e.type === 'audio_check' ? e.data : {}), ...(e.type === 'session_start' ? { at: e.at } : {}) }));
    expect(ev).toEqual([
      { seq: -3, type: 'session_start', at: '2026-11-18T08:58:00Z' },
      { seq: -2, type: 'audio_check', heard: false, tries: 1 },
      { seq: -1, type: 'restart' },
      { seq: 0, type: 'session_start', at: '2026-11-18T09:00:05Z' },
      { seq: 2, type: 'audio_check', heard: true, tries: 2 },
    ]);
  });
});

test('(vi) past the cap after a restart: the current attempt is kept whole; the ended one keeps its earliest rows', async () => {
  mockPatches.length = 0;
  mockRow = { id: 's1', admin_mode: 'coach_present', device: { block: 'rdf_auto' }, client_started_at: null, client_finished_at: null };
  // one attempt: a start, a miss and a pass, 147 more kept rows (voice), and one skip (an audit row, never capped)
  const attemptRows = (tag) => [
    START(0, '2026-11-18T08:58:00Z'),
    AC(1, false, 1, '2026-11-18T08:58:09Z'),
    AC(2, true, 2, '2026-11-18T08:58:21Z'),
    ...Array.from({ length: 147 }, (_, i) => ({ seq: 3 + i, type: 'voice', at: '2026-11-18T08:59:00Z', value: { tag, i } })),
    { seq: 150, type: 'skip_instructions', task_id: 'ur.letter_names5', at: '2026-11-18T09:00:00Z', value: { by: 'coach', tag } },
  ];
  // each attempt: 149 capped rows once the pick has run (its start, its latest check, 147 voice); two of them pass 200
  await batch(attemptRows('a1'));
  const r = await store.restartAttempt('s1', { clientSessionId: 'phone-2', at: '2026-11-18T09:01:00Z' });
  expect(r).toEqual({ ok: true, attempt: 1 });
  await batch(attemptRows('a2'));
  const ev = mockRow.device.events;
  const restartAt = ev.findIndex((e) => e.type === 'restart');
  const a1 = ev.slice(0, restartAt);
  const a2 = ev.slice(restartAt + 1);
  const capped = (rows) => rows.filter((e) => e.type !== 'skip_instructions');
  // the current attempt is whole: its start, its pass, all 147 voice rows and its skip
  expect(capped(a2)).toHaveLength(149);
  expect(a2.find((e) => e.type === 'session_start')).toBeTruthy();
  expect(a2.filter((e) => e.type === 'audio_check').map((e) => e.data)).toEqual([{ heard: true, tries: 2 }]);
  expect(a2.filter((e) => e.type === 'voice').map((e) => e.data.i)).toEqual(Array.from({ length: 147 }, (_, i) => i));
  // the ended attempt fills what is left of the cap with its EARLIEST rows: its start, its pass, then voice 0..48
  expect(capped(a1)).toHaveLength(200 - 149);
  expect(capped(a1).slice(0, 2).map((e) => e.type)).toEqual(['session_start', 'audio_check']);
  expect(a1.filter((e) => e.type === 'voice').map((e) => e.data.i)).toEqual(Array.from({ length: 49 }, (_, i) => i));
  // every restart and audit row is kept, and the row stays in seq order
  expect(ev.filter((e) => e.type === 'restart')).toHaveLength(1);
  expect(ev.filter((e) => e.type === 'skip_instructions').map((e) => e.data.tag)).toEqual(['a1', 'a2']);
  expect(ev.every((e, i) => i === 0 || ev[i - 1].seq < e.seq)).toBe(true);
});

test('the cap of kept events is unchanged: the start and the check are kept first, then 198 more', () => {
  const { keepEvents } = store.__internals;
  const many = [
    { seq: 1, type: 'session_start', data: null },
    { seq: 2, type: 'audio_check', data: null },
    ...Array.from({ length: 250 }, (_, i) => ({ seq: 3 + i, type: 'visibility_lost', data: null })),
  ];
  const kept = keepEvents([], many);
  expect(kept).toHaveLength(200);
  expect(kept.slice(0, 2).map((e) => e.type)).toEqual(['session_start', 'audio_check']);
});
