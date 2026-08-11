/**
 * bd-2531 — the write path. THIS is what makes the flow session-free.
 *
 * Every answer is persisted the moment it arrives, so the rows themselves carry
 * her position. No in-memory conversation state, nothing to expire, nothing to
 * lose if the process dies between indicator 3 and 4.
 *
 * Two invariants:
 *   * the header row is created lazily on her FIRST answer for a teacher — not
 *     at submit, because the score rows need something to hang off;
 *   * re-answering an indicator UPSERTS on (remark_id, indicator_ordinal), which
 *     is what "let me change my answer to question 2" needs, for free.
 */
const {
  ensureRemark,
  saveScore,
  saveComment,
  markSubmitted,
} = require('../../shared/services/remark/remark-write.repository');

// Chainable stub recording what would hit PostgREST.
function makeClient(results = {}) {
  const calls = [];
  const chain = (table) => {
    const c = {
      _t: table,
      insert(v) { calls.push({ op: 'insert', table, value: v }); return c; },
      upsert(v, opts) { calls.push({ op: 'upsert', table, value: v, opts }); return c; },
      update(v) { calls.push({ op: 'update', table, value: v }); return c; },
      select(cols) { calls.push({ op: 'select', table, cols }); return c; },
      eq(col, val) { calls.push({ op: 'eq', table, col, val }); return c; },
      maybeSingle() { return Promise.resolve(results[table] || { data: null, error: null }); },
      single() { return Promise.resolve(results[table] || { data: null, error: null }); },
      then(res) { return Promise.resolve(results[table] || { data: null, error: null }).then(res); },
    };
    return c;
  };
  return { calls, client: { from: (t) => chain(t) } };
}

const CTX = { cycleId: 'c-1', teacherId: 't-1', principalUserId: 'p-1', schoolId: 's-1' };

describe('bd-2531 — ensureRemark creates the header lazily', () => {
  test('an existing remark is reused, not duplicated', async () => {
    const { client, calls } = makeClient({
      supervisor_remarks: { data: { id: 'r-1' }, error: null },
    });
    const id = await ensureRemark(CTX, { client });
    expect(id).toBe('r-1');
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  test('a missing remark is inserted with the full identity', async () => {
    let created = false;
    const { client } = makeClient();
    const stub = {
      from: () => ({
        select: () => stub.from(), eq: () => stub.from(),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert(v) {
          created = v;
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'r-new' }, error: null }) }) };
        },
      }),
    };
    const id = await ensureRemark(CTX, { client: stub });
    expect(id).toBe('r-new');
    // cycle + teacher + principal must all be stamped: the UNIQUE key and the
    // audit trail both depend on them.
    expect(created).toMatchObject({
      cycle_id: 'c-1', teacher_id: 't-1', principal_user_id: 'p-1',
    });
    // NOT submitted on creation — it is a partial until she commits.
    expect(created.submitted_at).toBeUndefined();
  });
});

describe('bd-2531 — saveScore writes one answer, upserting on re-answer', () => {
  test('it upserts on (remark_id, indicator_ordinal)', async () => {
    const { client, calls } = makeClient();
    await saveScore('r-1', 2, 4, { client });
    const up = calls.find((c) => c.op === 'upsert');
    expect(up.table).toBe('supervisor_remark_scores');
    expect(up.value).toMatchObject({ remark_id: 'r-1', indicator_ordinal: 2, score: 4 });
    // Without this onConflict target, a re-answer would violate the UNIQUE
    // constraint instead of replacing the old score.
    expect(up.opts.onConflict).toBe('remark_id,indicator_ordinal');
  });

  test('an out-of-range score is refused BEFORE hitting the database', async () => {
    // The DB CHECK would also catch it, but failing here gives the handler a
    // clean error to re-prompt on rather than a constraint violation.
    const { client } = makeClient();
    for (const bad of [0, 5, -1, 2.5, null, 'four']) {
      await expect(saveScore('r-1', 1, bad, { client })).rejects.toThrow(/score/i);
    }
  });

  test('an unknown indicator ordinal is refused', async () => {
    const { client } = makeClient();
    await expect(saveScore('r-1', 6, 3, { client })).rejects.toThrow(/indicator|ordinal/i);
  });
});

describe('bd-2531 — saveComment', () => {
  test('text comments are stored with their language', async () => {
    const { client, calls } = makeClient();
    await saveComment('r-1', { text: 'Doing well.', language: 'ur' }, { client });
    const up = calls.find((c) => c.op === 'update');
    expect(up.value).toMatchObject({ comment_text: 'Doing well.', comment_language: 'ur' });
  });

  test('a voice comment keeps the audio id for provenance', async () => {
    const { client, calls } = makeClient();
    await saveComment('r-1', { text: 'transcribed words', audioId: 'wamid.xyz' }, { client });
    expect(calls.find((c) => c.op === 'update').value)
      .toMatchObject({ comment_text: 'transcribed words', comment_audio_id: 'wamid.xyz' });
  });

  test('skipping records the skip WITHOUT inventing comment text', async () => {
    // A skipped comment must be distinguishable from "not asked yet", or the
    // flow re-prompts forever. Empty string, not null.
    const { client, calls } = makeClient();
    await saveComment('r-1', { skipped: true }, { client });
    const v = calls.find((c) => c.op === 'update').value;
    expect(v.comment_text).toBe('');
  });
});

describe('bd-2531 — markSubmitted is the commit', () => {
  test('it stamps submitted_at', async () => {
    const { client, calls } = makeClient();
    await markSubmitted('r-1', { client });
    expect(calls.find((c) => c.op === 'update').value.submitted_at).toBeTruthy();
  });

  test('it targets the one remark by id', async () => {
    const { client, calls } = makeClient();
    await markSubmitted('r-1', { client });
    expect(calls.some((c) => c.op === 'eq' && c.col === 'id' && c.val === 'r-1')).toBe(true);
  });
});
