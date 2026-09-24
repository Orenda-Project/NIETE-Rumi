'use strict';
/**
 * The teacher-nudge core — `bot/shared/services/nudges/teacher-nudges.store.js`.
 *
 * The store is the only thing standing between two new scheduled asks and the
 * failure mode that kills scheduled messaging: the same teacher asked twice.
 * Two guards do that work, and both are asserted here against a supabase stub
 * that REALLY filters — a stub that ignores `.eq()` would let a broken
 * implementation pass.
 *
 *   G1  the UNIQUE (user_id, nudge_date, kind). `schedule` INSERTs and treats
 *       23505 as "somebody already scheduled this", returning the EXISTING row
 *       with created:false. Five replicas building the 15:00 cohort therefore
 *       produce one row and four no-ops.
 *   G2  the claim. supabase-js has no `update … limit`, so `claimDue` selects
 *       candidate ids and then flips them pending → sending with
 *       `.eq('status','pending')` still on the update, taking ONLY the rows the
 *       update returned. Two replicas that select the same ids each get only
 *       what their own UPDATE won. Dropping that one `.eq` turns a claim back
 *       into a check-then-act, and the test below fails when it is missing.
 *
 * Class D (every Supabase chain checks `error`) and Class N (a catch logs at
 * error level) are asserted rather than assumed.
 */

// ── the supabase stub: a real little table, not a mock that says yes ──────────
const NOW_ISO = '2026-09-23T10:00:00.000Z';

const db = {
  rows: [],
  calls: [],
  /** Queue of { op, error } — the next chain resolving that op fails with it. */
  failures: [],
  seq: 0,
};

const uniqueKey = (r) => `${r.user_id}|${r.nudge_date}|${r.kind}`;

function chain(table) {
  const ctx = { table, filters: [], op: 'select', patch: null, row: null, order: null, limit: null, columns: null };
  db.calls.push(ctx);

  const matches = (r) => ctx.filters.every(([op, col, val]) => {
    const cell = r[col];
    switch (op) {
      case 'eq': return cell === val;
      case 'neq': return cell !== val;
      case 'in': return val.includes(cell);
      case 'lt': return String(cell) < String(val);
      case 'lte': return String(cell) <= String(val);
      case 'gt': return String(cell) > String(val);
      case 'gte': return String(cell) >= String(val);
      case 'is': return val === null ? (cell === null || cell === undefined) : cell === val;
      default: throw new Error(`stub: unsupported filter ${op}`);
    }
  });

  const selected = () => {
    let out = db.rows.filter(matches);
    if (ctx.order) {
      const { col, asc } = ctx.order;
      out = [...out].sort((a, b) => (asc ? 1 : -1) * String(a[col]).localeCompare(String(b[col])));
    }
    if (ctx.limit != null) out = out.slice(0, ctx.limit);
    return out;
  };

  const resolve = () => {
    const forced = db.failures.findIndex((f) => f.op === ctx.op);
    if (forced >= 0) {
      const [f] = db.failures.splice(forced, 1);
      return { data: null, error: f.error };
    }
    if (ctx.op === 'insert') {
      const row = {
        id: `n-${++db.seq}`, status: 'pending', context: {}, sent_at: null,
        answered_at: null, choice: null, quiz_id: null,
        created_at: NOW_ISO, updated_at: NOW_ISO, ...ctx.row,
      };
      if (db.rows.some((r) => uniqueKey(r) === uniqueKey(row))) {
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint "teacher_nudges_one_per_day"' },
        };
      }
      db.rows.push(row);
      return { data: [{ ...row }], error: null };
    }
    if (ctx.op === 'update') {
      const hit = db.rows.filter(matches);
      for (const r of hit) Object.assign(r, ctx.patch);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    return { data: selected().map((r) => ({ ...r })), error: null };
  };

  const c = {
    select: (cols) => { ctx.columns = cols || '*'; return c; },
    insert: (row) => { ctx.op = 'insert'; ctx.row = row; return c; },
    update: (patch) => { ctx.op = 'update'; ctx.patch = patch; return c; },
    order: (col, opts) => { ctx.order = { col, asc: !opts || opts.ascending !== false }; return c; },
    limit: (n) => { ctx.limit = n; return c; },
    single: async () => { const r = resolve(); return { data: r.data ? r.data[0] || null : null, error: r.error }; },
    maybeSingle: async () => { const r = resolve(); return { data: r.data ? r.data[0] || null : null, error: r.error }; },
    then: (res, rej) => Promise.resolve(resolve()).then(res, rej),
  };
  for (const op of ['eq', 'neq', 'in', 'lt', 'lte', 'gt', 'gte', 'is']) {
    c[op] = (col, val) => { ctx.filters.push([op, col, val]); return c; };
  }
  return c;
}

const mockFrom = jest.fn((t) => chain(t));
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockFrom(...a) }));

const mockLog = jest.fn();
jest.mock('../../shared/utils/logger', () => ({
  logToFile: (...a) => mockLog(...a),
  generateCorrelationId: () => 'test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const store = require('../../shared/services/nudges/teacher-nudges.store');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KIND = 'lp_quiz_offer';

const seed = (over = {}) => {
  const row = {
    id: `s-${++db.seq}`, user_id: TEACHER, kind: KIND, nudge_date: '2026-09-23',
    status: 'pending', scheduled_at: '2026-09-23T10:00:00.000Z',
    sent_at: null, answered_at: null, choice: null, quiz_id: null,
    context: {}, created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  };
  db.rows.push(row);
  return row;
};

const findCall = (pred) => db.calls.find(pred);
const errorLogs = () => mockLog.mock.calls.filter(([, , level]) => level === 'error');

beforeEach(() => {
  jest.clearAllMocks();
  db.rows = []; db.calls = []; db.failures = []; db.seq = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SKIP_REASONS — the closed vocabulary of "we deliberately did not ask"', () => {
  test('is exported, frozen, and holds the fifteen reasons the plan names', () => {
    expect(store.SKIP_REASONS).toEqual([
      'coached_today', 'offered_today', 'sent_today', 'coaching_yes_today', 'window_closed',
      'weekly_cap', 'declined_streak', 'consecutive_day', 'quiet_hours', 'assessment_day',
      'no_lesson', 'disabled', 'sector_not_piloted', 'not_school_day', 'in_progress_coaching',
    ]);
    expect(Object.isFrozen(store.SKIP_REASONS)).toBe(true);
  });
});

describe('schedule — G1, the UNIQUE is the concurrency control', () => {
  test('inserts a pending row carrying the teacher, the PKT day, the kind, the due instant and the context', async () => {
    const out = await store.schedule({
      userId: TEACHER, kind: KIND, nudgeDate: '2026-09-23',
      scheduledAt: new Date('2026-09-23T10:00:00Z'), context: { lessons: ['l1'] },
    });

    expect(out.created).toBe(true);
    expect(out.row).toEqual(expect.objectContaining({
      user_id: TEACHER, kind: KIND, nudge_date: '2026-09-23',
      scheduled_at: '2026-09-23T10:00:00.000Z', status: 'pending',
      context: { lessons: ['l1'] },
    }));
    expect(db.rows).toHaveLength(1);
  });

  test('a scheduledAt given as an ISO string is stored unchanged', async () => {
    const out = await store.schedule({
      userId: TEACHER, kind: KIND, nudgeDate: '2026-09-23', scheduledAt: '2026-09-23T10:30:00.000Z',
    });
    expect(out.row.scheduled_at).toBe('2026-09-23T10:30:00.000Z');
  });

  test('the second replica gets created:false and THE EXISTING ROW — not a new one, not null', async () => {
    const first = await store.schedule({
      userId: TEACHER, kind: KIND, nudgeDate: '2026-09-23',
      scheduledAt: NOW_ISO, context: { lessons: ['l1'] },
    });
    const second = await store.schedule({
      userId: TEACHER, kind: KIND, nudgeDate: '2026-09-23',
      scheduledAt: NOW_ISO, context: { lessons: ['SOMETHING ELSE'] },
    });

    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    // the loser's context never overwrites the winner's
    expect(second.row.context).toEqual({ lessons: ['l1'] });
    expect(db.rows).toHaveLength(1);
  });

  test('the same teacher on a DIFFERENT day, and a different kind on the same day, both insert', async () => {
    await store.schedule({ userId: TEACHER, kind: KIND, nudgeDate: '2026-09-23', scheduledAt: NOW_ISO });
    await store.schedule({ userId: TEACHER, kind: KIND, nudgeDate: '2026-09-24', scheduledAt: NOW_ISO });
    await store.schedule({ userId: TEACHER, kind: 'coaching_after_lp', nudgeDate: '2026-09-23', scheduledAt: NOW_ISO });
    await store.schedule({ userId: OTHER, kind: KIND, nudgeDate: '2026-09-23', scheduledAt: NOW_ISO });
    expect(db.rows).toHaveLength(4);
  });

  test('Class D: an insert error that is NOT 23505 throws and is logged at error level', async () => {
    db.failures.push({ op: 'insert', error: { code: '08006', message: 'connection reset' } });
    await expect(store.schedule({
      userId: TEACHER, kind: KIND, nudgeDate: '2026-09-23', scheduledAt: NOW_ISO,
    })).rejects.toThrow(/connection reset/);
    expect(errorLogs().length).toBeGreaterThan(0);
  });
});

describe('claimDue — G2, a claim and not a check-then-act', () => {
  test('claims only rows that are pending, due, and of the asked-for kind', async () => {
    const due = seed({ scheduled_at: '2026-09-23T09:00:00.000Z' });
    seed({ scheduled_at: '2026-09-23T23:00:00.000Z' });              // not due yet
    seed({ status: 'sent' });                                         // already sent
    seed({ kind: 'coaching_after_lp' });                              // another kind

    const claimed = await store.claimDue({ kind: KIND, limit: 50, now: new Date(NOW_ISO) });

    expect(claimed.map((r) => r.id)).toEqual([due.id]);
    expect(db.rows.find((r) => r.id === due.id).status).toBe('sending');
    // nothing else moved
    expect(db.rows.filter((r) => r.status === 'sending')).toHaveLength(1);
  });

  test('the UPDATE itself is guarded on status = pending — so a second sweeper claims nothing', async () => {
    seed({ id: 'a', scheduled_at: '2026-09-23T09:00:00.000Z' });
    seed({ id: 'b', scheduled_at: '2026-09-23T09:00:00.000Z' });

    const first = await store.claimDue({ kind: KIND, limit: 50, now: new Date(NOW_ISO) });
    expect(first.map((r) => r.id).sort()).toEqual(['a', 'b']);

    // A second replica selected the same ids a moment earlier; its UPDATE now
    // matches nothing because the rows are no longer pending. If the
    // implementation dropped `.eq('status','pending')` from the update, this
    // second call would "claim" both rows a second time and the assertion fails.
    const second = await store.claimDue({ kind: KIND, limit: 50, now: new Date(NOW_ISO) });
    expect(second).toEqual([]);

    const update = findCall((c) => c.op === 'update');
    expect(update.filters).toEqual(expect.arrayContaining([['eq', 'status', 'pending']]));
    expect(update.filters.some(([op, col]) => op === 'in' && col === 'id')).toBe(true);
    expect(update.patch).toEqual(expect.objectContaining({ status: 'sending' }));
    expect(update.patch.updated_at).toEqual(expect.any(String));
  });

  test('only the rows the UPDATE returned are treated as claimed', async () => {
    seed({ id: 'a', scheduled_at: '2026-09-23T09:00:00.000Z' });
    const b = seed({ id: 'b', scheduled_at: '2026-09-23T09:00:00.000Z' });
    // 'b' is won by another replica between the select and the update.
    const realFrom = mockFrom.getMockImplementation();
    mockFrom.mockImplementationOnce((t) => realFrom(t))          // the candidate select
      .mockImplementationOnce((t) => { b.status = 'sending'; return realFrom(t); }); // the update

    const claimed = await store.claimDue({ kind: KIND, limit: 50, now: new Date(NOW_ISO) });
    expect(claimed.map((r) => r.id)).toEqual(['a']);
  });

  test('the candidate select carries the per-tick cap and takes the oldest first', async () => {
    for (let i = 0; i < 5; i++) seed({ scheduled_at: `2026-09-23T0${i}:00:00.000Z` });
    const claimed = await store.claimDue({ kind: KIND, limit: 2, now: new Date(NOW_ISO) });
    expect(claimed).toHaveLength(2);
    const sel = findCall((c) => c.op === 'select');
    expect(sel.limit).toBe(2);
    expect(sel.order).toEqual({ col: 'scheduled_at', asc: true });
  });

  test('no candidates → no UPDATE is issued at all', async () => {
    seed({ status: 'sent' });
    const claimed = await store.claimDue({ kind: KIND, limit: 50, now: new Date(NOW_ISO) });
    expect(claimed).toEqual([]);
    expect(db.calls.some((c) => c.op === 'update')).toBe(false);
  });

  test('Class D: a select error returns [] , logs at error level, and updates nothing', async () => {
    seed({ scheduled_at: '2026-09-23T09:00:00.000Z' });
    db.failures.push({ op: 'select', error: { message: 'timeout' } });
    const claimed = await store.claimDue({ kind: KIND, limit: 50, now: new Date(NOW_ISO) });
    expect(claimed).toEqual([]);
    expect(db.calls.some((c) => c.op === 'update')).toBe(false);
    expect(errorLogs().length).toBeGreaterThan(0);
  });

  test('Class D: an update error returns [] and logs at error level', async () => {
    seed({ scheduled_at: '2026-09-23T09:00:00.000Z' });
    db.failures.push({ op: 'update', error: { message: 'deadlock detected' } });
    const claimed = await store.claimDue({ kind: KIND, limit: 50, now: new Date(NOW_ISO) });
    expect(claimed).toEqual([]);
    expect(errorLogs().length).toBeGreaterThan(0);
  });
});

describe('markSent / markSkipped / markFailed — the terminal marks', () => {
  test('markSent stamps sent + sent_at and MERGES the message ids into the context it found', async () => {
    const row = seed({ status: 'sending', context: { lessons: ['l1'], class: { grade: 3 } } });
    const ok = await store.markSent(row.id, { messageIds: ['wamid.1'], context: { withVideo: true } });

    expect(ok).toBe(true);
    const after = db.rows.find((r) => r.id === row.id);
    expect(after.status).toBe('sent');
    expect(after.sent_at).toEqual(expect.any(String));
    expect(after.context).toEqual({
      lessons: ['l1'], class: { grade: 3 }, withVideo: true, message_ids: ['wamid.1'],
    });
  });

  test('markSkipped records the reason in the context and never erases what was there', async () => {
    const row = seed({ status: 'sending', context: { lessons: ['l1'] } });
    await store.markSkipped(row.id, 'weekly_cap', { asked_this_week: 2 });

    const after = db.rows.find((r) => r.id === row.id);
    expect(after.status).toBe('skipped');
    expect(after.context).toEqual({ lessons: ['l1'], skip_reason: 'weekly_cap', asked_this_week: 2 });
  });

  test('markSkipped REFUSES a reason outside SKIP_REASONS, and writes nothing', async () => {
    const row = seed({ status: 'sending' });
    await expect(store.markSkipped(row.id, 'she_seemed_busy')).rejects.toThrow(/she_seemed_busy/);
    expect(db.rows.find((r) => r.id === row.id).status).toBe('sending');
    expect(db.calls.some((c) => c.op === 'update')).toBe(false);
  });

  test('markFailed records the error MESSAGE, not the object, and marks failed', async () => {
    const row = seed({ status: 'sending', context: { lessons: ['l1'] } });
    await store.markFailed(row.id, new Error('WhatsApp 131047: re-engagement message'));

    const after = db.rows.find((r) => r.id === row.id);
    expect(after.status).toBe('failed');
    expect(after.context.error).toBe('WhatsApp 131047: re-engagement message');
    expect(after.context.lessons).toEqual(['l1']);
  });

  test('markFailed survives a non-Error being thrown at it', async () => {
    const row = seed({ status: 'sending' });
    await store.markFailed(row.id, 'plain string blew up');
    expect(db.rows.find((r) => r.id === row.id).context.error).toBe('plain string blew up');
  });

  test('Class D/N: an update error returns false and is logged at error level', async () => {
    const row = seed({ status: 'sending' });
    db.failures.push({ op: 'update', error: { message: 'connection reset' } });
    await expect(store.markSent(row.id, { messageIds: [] })).resolves.toBe(false);
    expect(errorLogs().length).toBeGreaterThan(0);
  });
});

describe('defer — "not now", handed back by the claim holder', () => {
  test('a claimed row goes back to pending, due at the new instant, and the context is merged, not replaced', async () => {
    const row = seed({ status: 'sending', context: { lessons: ['l1'] } });
    const ok = await store.defer(row.id, new Date('2026-09-23T10:06:00.000Z'), { deferred_for: 'lp_survey' });

    expect(ok).toBe(true);
    const after = db.rows.find((r) => r.id === row.id);
    expect(after.status).toBe('pending');
    expect(after.scheduled_at).toBe('2026-09-23T10:06:00.000Z');
    expect(after.context).toEqual(expect.objectContaining({
      lessons: ['l1'], deferred_for: 'lp_survey', deferred_at: expect.any(String),
    }));
  });

  test('the next claim before that instant takes nothing; after it, the row is claimed again', async () => {
    const row = seed({ status: 'sending' });
    await store.defer(row.id, '2026-09-23T10:06:00.000Z', { deferred_for: 'lp_survey' });

    expect(await store.claimDue({ kind: KIND, now: new Date('2026-09-23T10:05:00.000Z') })).toEqual([]);
    const again = await store.claimDue({ kind: KIND, now: new Date('2026-09-23T10:06:30.000Z') });
    expect(again.map((r) => r.id)).toEqual([row.id]);
  });

  test('guarded on sending — a row that finished in between is never revived', async () => {
    const row = seed({ status: 'sent' });
    const ok = await store.defer(row.id, '2026-09-23T10:06:00.000Z', { deferred_for: 'lp_survey' });

    expect(ok).toBe(false);
    expect(db.rows.find((r) => r.id === row.id).status).toBe('sent');
  });
});

describe('expireStuck — a row nobody finished must not sit in sending for ever', () => {
  test('a sending row older than the ceiling becomes failed with context.error = stuck_sending', async () => {
    const stuck = seed({
      status: 'sending', context: { lessons: ['l1'] },
      updated_at: '2026-09-23T09:40:00.000Z',            // 20 minutes before now
    });
    const res = await store.expireStuck({ olderThanMinutes: 10, now: new Date(NOW_ISO) });

    expect(res).toBe(1);
    const after = db.rows.find((r) => r.id === stuck.id);
    expect(after.status).toBe('failed');
    expect(after.context).toEqual({ lessons: ['l1'], error: 'stuck_sending' });
  });

  test('a young sending row and a pending row are both left alone', async () => {
    seed({ status: 'sending', updated_at: '2026-09-23T09:58:00.000Z' });   // 2 minutes old
    seed({ status: 'pending', updated_at: '2026-09-23T08:00:00.000Z' });
    const res = await store.expireStuck({ olderThanMinutes: 10, now: new Date(NOW_ISO) });
    expect(res).toBe(0);
    expect(db.rows.map((r) => r.status).sort()).toEqual(['pending', 'sending']);
  });

  test('the write is still guarded on status = sending — a row that finished in between is not clobbered', async () => {
    seed({ status: 'sending', updated_at: '2026-09-23T09:00:00.000Z' });
    await store.expireStuck({ olderThanMinutes: 10, now: new Date(NOW_ISO) });
    const update = findCall((c) => c.op === 'update');
    expect(update.filters).toEqual(expect.arrayContaining([['eq', 'status', 'sending']]));
  });

  test('defaults to a ten-minute ceiling', async () => {
    seed({ status: 'sending', updated_at: '2026-09-23T09:30:00.000Z' });
    const res = await store.expireStuck({ now: new Date(NOW_ISO) });
    expect(res).toBe(1);
  });

  test('Class D: a select error returns 0 and logs at error level', async () => {
    seed({ status: 'sending', updated_at: '2026-09-23T09:00:00.000Z' });
    db.failures.push({ op: 'select', error: { message: 'timeout' } });
    await expect(store.expireStuck({ now: new Date(NOW_ISO) })).resolves.toBe(0);
    expect(errorLogs().length).toBeGreaterThan(0);
  });
});

describe('recordAnswer / rowsFor / todayRow', () => {
  test('recordAnswer stamps the choice, the instant and the quiz it produced', async () => {
    const row = seed({ status: 'sent' });
    await store.recordAnswer(row.id, { choice: 'yes', quizId: 'q-1' });
    const after = db.rows.find((r) => r.id === row.id);
    expect(after.choice).toBe('yes');
    expect(after.quiz_id).toBe('q-1');
    expect(after.answered_at).toEqual(expect.any(String));
    // the send status is a different fact and is NOT overwritten by an answer
    expect(after.status).toBe('sent');
  });

  test('recordAnswer accepts a class pick, and refuses a choice outside the vocabulary', async () => {
    const row = seed({ status: 'sent' });
    await store.recordAnswer(row.id, { choice: 'class:g3_maths' });
    expect(db.rows.find((r) => r.id === row.id).choice).toBe('class:g3_maths');

    await expect(store.recordAnswer(row.id, { choice: 'Record my lesson' }))
      .rejects.toThrow(/Record my lesson/);
  });

  test('rowsFor filters by teacher, kind and date range, newest day first', async () => {
    seed({ nudge_date: '2026-09-21' });
    seed({ nudge_date: '2026-09-22' });
    seed({ nudge_date: '2026-09-23' });
    seed({ nudge_date: '2026-09-23', kind: 'coaching_after_lp' });
    seed({ nudge_date: '2026-09-23', user_id: OTHER });

    const rows = await store.rowsFor(TEACHER, { kind: KIND, fromDate: '2026-09-22', toDate: '2026-09-23' });
    expect(rows.map((r) => r.nudge_date)).toEqual(['2026-09-23', '2026-09-22']);
  });

  test('rowsFor without a kind returns both kinds for that teacher', async () => {
    seed({ nudge_date: '2026-09-23' });
    seed({ nudge_date: '2026-09-23', kind: 'coaching_after_lp' });
    seed({ nudge_date: '2026-09-23', user_id: OTHER });
    const rows = await store.rowsFor(TEACHER, {});
    expect(rows).toHaveLength(2);
  });

  test('todayRow returns the one row for (teacher, kind, day) — or null, never undefined', async () => {
    const row = seed({ nudge_date: '2026-09-23' });
    await expect(store.todayRow(TEACHER, KIND, '2026-09-23')).resolves.toEqual(
      expect.objectContaining({ id: row.id }));
    await expect(store.todayRow(TEACHER, KIND, '2026-09-24')).resolves.toBeNull();
  });

  test('Class D: a read error returns the empty answer and logs at error level', async () => {
    db.failures.push({ op: 'select', error: { message: 'timeout' } });
    await expect(store.rowsFor(TEACHER, {})).resolves.toEqual([]);
    db.failures.push({ op: 'select', error: { message: 'timeout' } });
    await expect(store.todayRow(TEACHER, KIND, '2026-09-23')).resolves.toBeNull();
    expect(errorLogs().length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('claimQuiz / byId — the answer that makes a quiz makes exactly one', () => {
  test('the first claim wins and attaches its quiz; a second claim loses and changes nothing', async () => {
    const row = seed({ status: 'sent' });
    await expect(store.claimQuiz(row.id, 'q-first')).resolves.toBe(true);
    await expect(store.claimQuiz(row.id, 'q-second')).resolves.toBe(false);
    expect(db.rows.find((r) => r.id === row.id).quiz_id).toBe('q-first');
  });

  test('the claim is conditional ON THE UPDATE — quiz_id IS NULL, not a read first', async () => {
    const row = seed({ status: 'sent' });
    await store.claimQuiz(row.id, 'q-1');
    const update = findCall((c) => c.op === 'update' && c.patch && c.patch.quiz_id === 'q-1');
    expect(update.filters).toEqual(expect.arrayContaining([['eq', 'id', row.id], ['is', 'quiz_id', null]]));
    expect(db.calls.filter((c) => c.op === 'select' && c.columns === '*')).toHaveLength(0);
  });

  test('Class D: an update error is a lost claim, logged at error level', async () => {
    const row = seed({ status: 'sent' });
    db.failures.push({ op: 'update', error: { message: 'timeout' } });
    await expect(store.claimQuiz(row.id, 'q-1')).resolves.toBe(false);
    expect(errorLogs().length).toBeGreaterThanOrEqual(1);
  });

  test('byId returns the row, or null for an unknown id', async () => {
    const row = seed();
    await expect(store.byId(row.id)).resolves.toEqual(expect.objectContaining({ id: row.id }));
    await expect(store.byId('nope')).resolves.toBeNull();
  });
});
