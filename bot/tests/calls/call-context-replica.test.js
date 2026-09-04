/**
 * P1 (bd-vrbk4.2) — the read-replica split for the calls stack.
 *
 * Production NIETE has a read-only replica
 * (ihzciabopbttygxxgrkm-rr-ap-south-1-tlrbo). The operator asked that calls read
 * from it so a live call cannot add load to the database every other feature
 * shares. The whole calls stack currently uses ONE client, so this is a routing
 * change and the only thing worth testing is WHICH CLIENT each query lands on.
 *
 * The rule the tests encode: **the replica serves reads of tables the calls
 * stack does not itself write.** Everything the stack writes — `calls`,
 * `call_trace`, `call_memory` — is read back from the PRIMARY, because every one
 * of those reads is a read-after-write whose failure mode is silent and
 * expensive:
 *
 *   call_memory  written at call end, read at the next call's start. On the
 *                replica, a teacher who rings back inside the lag window is met
 *                by an assistant that has forgotten her — and we would go
 *                hunting a summariser bug that does not exist.
 *   calls        the budget governor's two inputs (callsToday, weeklySpendUsd)
 *                COUNT rows this stack just inserted. On the replica, a caller
 *                redialling inside the lag window reads a stale count and walks
 *                straight through the per-caller daily limit; the weekly budget
 *                cap has the same hole, denominated in dollars.
 *
 * Both are lag bugs that look like feature bugs. They are cheap to prevent here
 * and very expensive to diagnose in production, so they are asserted, not
 * commented.
 */

const REPLICA_URL = 'https://ihzciabopbttygxxgrkm-rr-ap-south-1-tlrbo.supabase.co';

/** Every query resolves the same benign empty shape; we assert routing, not data. */
const EMPTY = { data: [], error: null, count: 0 };
const EMPTY_ONE = { data: null, error: null };

function makeBuilder() {
  const b = {};
  ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'gte', 'lte', 'ilike', 'or', 'range']
    .forEach((m) => { b[m] = () => b; });
  b.maybeSingle = () => Promise.resolve(EMPTY_ONE);
  b.single = () => Promise.resolve(EMPTY_ONE);
  b.insert = () => Promise.resolve({ error: null });
  b.upsert = () => Promise.resolve({ error: null });
  b.update = () => b;
  b.then = (res, rej) => Promise.resolve(EMPTY).then(res, rej);
  return b;
}

/** A client that records which tables it was asked for, tagged primary/replica. */
function makeClient(tag, sink, opts = {}) {
  return {
    __tag: tag,
    from(table) {
      sink.push({ tag, table });
      if (opts.throwOnRead) throw new Error('replica unreachable');
      return makeBuilder();
    },
  };
}

let sink;
let replicaOpts;

/** Route every read of `table` to exactly one client, and say which. */
function tagFor(table) {
  const hit = sink.filter((r) => r.table === table);
  expect(hit.length).toBeGreaterThan(0);
  return hit.map((r) => r.tag);
}

function loadStack({ replica = true } = {}) {
  jest.resetModules();
  sink = [];
  replicaOpts = {};

  if (replica) process.env.NIETE_SUPABASE_REPLICA_URL = REPLICA_URL;
  else delete process.env.NIETE_SUPABASE_REPLICA_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.SUPABASE_URL = 'https://ihzciabopbttygxxgrkm.supabase.co';

  jest.doMock('../../shared/config/supabase', () => makeClient('primary', sink));
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: () => makeClient('replica', sink, replicaOpts),
  }));

  return {
    repo: require('../../shared/calls/call-context.repo'),
    tools: require('../../shared/calls/call-tools.repo'),
    log: require('../../shared/calls/call-log.service'),
  };
}

afterEach(() => {
  delete process.env.NIETE_SUPABASE_REPLICA_URL;
});

describe('replica routing — reads of tables the calls stack does not write', () => {
  test('the caller profile lookup reads the REPLICA', async () => {
    const { repo } = loadStack();
    await repo.fetchUser('923365709413');
    expect(tagFor('users')).toEqual(['replica']);
  });

  test('coaching history reads the REPLICA', async () => {
    const { repo } = loadStack();
    await repo.fetchLatestCoaching('user-uuid');
    expect(tagFor('coaching_sessions')).toEqual(['replica']);
  });

  test('the upcoming-visit lookup reads the REPLICA', async () => {
    const { repo } = loadStack();
    await repo.fetchUpcomingVisit('user-uuid');
    expect(tagFor('hcp_visit_schedules')).toEqual(['replica']);
  });

  test('training progress reads the REPLICA', async () => {
    const { repo } = loadStack();
    await repo.fetchTraining('user-uuid');
    expect(tagFor('teacher_training_progress')).toEqual(['replica']);
  });

  test('the call-tools schedule search reads the REPLICA', async () => {
    const { tools } = loadStack();
    await tools.findSchedules({ userId: 'user-uuid' });
    expect(tagFor('observation_schedules')).toEqual(['replica']);
  });
});

describe('primary pinning — the read-after-write paths', () => {
  test('call_memory is READ from the PRIMARY even with a replica configured', async () => {
    // The lag guard. Written at call end, read at the next call's start.
    const { repo } = loadStack();
    await repo.fetchMemory('923365709413');
    expect(tagFor('call_memory')).toEqual(['primary']);
  });

  test('call_memory is WRITTEN to the PRIMARY', async () => {
    const { repo } = loadStack();
    await repo.upsertMemory('923365709413', { summary: 'x', callCount: 2 });
    expect(tagFor('call_memory')).toEqual(['primary']);
  });

  test('the per-caller daily count reads the PRIMARY — it counts rows we just inserted', async () => {
    const { log } = loadStack();
    await log.callsToday('923365709413');
    expect(tagFor('calls')).toEqual(['primary']);
  });

  test('the weekly spend total reads the PRIMARY — the budget cap has the same hole', async () => {
    const { log } = loadStack();
    await log.weeklySpendUsd(new Date('2026-09-01T00:00:00Z'));
    expect(tagFor('calls')).toEqual(['primary']);
  });

  test('the call row and its trace are WRITTEN to the PRIMARY', async () => {
    const { log } = loadStack();
    await log.logCallStart({ waCallId: 'CALL1', from: '923365709413', direction: 'inbound' });
    await log.recordTrace({ waCallId: 'CALL1', seq: 1, kind: 'tool', name: 'find_coaching' });
    expect(tagFor('calls')).toEqual(['primary']);
    expect(tagFor('call_trace')).toEqual(['primary']);
  });
});

describe('no replica configured — staging and any fresh clone are unchanged', () => {
  test('every read lands on the primary when NIETE_SUPABASE_REPLICA_URL is unset', async () => {
    const { repo, log } = loadStack({ replica: false });
    await repo.fetchUser('923365709413');
    await repo.fetchLatestCoaching('user-uuid');
    await repo.fetchMemory('923365709413');
    await log.callsToday('923365709413');
    expect(sink.every((r) => r.tag === 'primary')).toBe(true);
  });
});

describe('replica failure degrades to the primary, never to a failed call', () => {
  test('a replica read that throws is retried on the primary and still returns', async () => {
    const { repo } = loadStack();
    replicaOpts.throwOnRead = true;
    await expect(repo.fetchUser('923365709413')).resolves.toBeNull();
    expect(tagFor('users')).toEqual(['replica', 'primary']);
  });
});
