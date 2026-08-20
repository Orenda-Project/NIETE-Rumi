'use strict';
/**
 * P1.2 — the move-list store/resolver. DB is MOCKED (injected chainable client). Encodes the rule that
 * a session resolves the EXACT version the teacher downloaded, never "latest" (bd-wmfsp.3).
 */
const { resolveMoveList, upsertMoveList, TABLE } = require('../../../bot/shared/services/coaching/fidelity/lp-fidelity-store');

// a chainable supabase double: records .from/.select/.eq/.order/.limit/.upsert, resolves to `result` at
// .maybeSingle(). Terminal thenable not needed — all our calls end in maybeSingle().
function mockSb(result = { data: null, error: null }) {
  const calls = { from: [], eq: {}, upsert: null, order: null };
  const chain = {
    select() { return chain; },
    eq(col, val) { calls.eq[col] = val; return chain; },
    order(col, o) { calls.order = { col, ...o }; return chain; },
    limit() { return chain; },
    upsert(payload, optsArg) { calls.upsert = { payload, optsArg }; return chain; },
    maybeSingle() { return Promise.resolve(result); },
  };
  return {
    calls,
    from(t) { calls.from.push(t); return chain; },
  };
}

const MOVES = [{ move_id: 'm1', text: 'x', bucket: 'must_happen' }];

describe('lp-fidelity-store', () => {
  test('resolves the EXACT version the teacher downloaded (lesson_id + version_stamp + content_hash)', async () => {
    const sb = mockSb({ data: { lesson_id: 'grade_5_math_ch5_seg995', version_stamp: 'v8-2026-08-19', content_hash: 'abc', template: 'STANDARD', moves: MOVES }, error: null });
    const out = await resolveMoveList(
      { lesson_id: 'grade_5_math_ch5_seg995', version_stamp: 'v8-2026-08-19', content_hash: 'abc' },
      { client: sb }
    );
    expect(sb.calls.from[0]).toBe(TABLE);
    expect(sb.calls.eq.lesson_id).toBe('grade_5_math_ch5_seg995');
    expect(sb.calls.eq.version_stamp).toBe('v8-2026-08-19');
    expect(sb.calls.eq.content_hash).toBe('abc');
    expect(sb.calls.order).toBeNull(); // exact path must NOT fall through to "latest"
    expect(out.moves).toEqual(MOVES);
    expect(out.resolved).toBe('exact');
  });

  test('unknown lesson/version → null, never throws (caller treats as lp_absent)', async () => {
    const sb = mockSb({ data: null, error: null });
    const out = await resolveMoveList({ lesson_id: 'nope', version_stamp: 'v', content_hash: 'h' }, { client: sb });
    expect(out).toBeNull();
  });

  test('no fallback to current by default (do NOT silently score against a different version)', async () => {
    const sb = mockSb({ data: null, error: null });
    const out = await resolveMoveList({ lesson_id: 'L', version_stamp: 'v', content_hash: 'h' }, { client: sb });
    expect(sb.calls.order).toBeNull(); // never ran the ordered "latest" query
    expect(out).toBeNull();
  });

  test('fallbackToCurrent:true → newest row for the lesson, flagged resolved:current', async () => {
    const sb = mockSb({ data: { lesson_id: 'L', version_stamp: 'v9', content_hash: 'h9', template: 'STANDARD', moves: MOVES }, error: null });
    const out = await resolveMoveList({ lesson_id: 'L' }, { client: sb, fallbackToCurrent: true });
    expect(sb.calls.order).toEqual({ col: 'created_at', ascending: false });
    expect(out.resolved).toBe('current');
  });

  test('missing lesson_id → null (guard)', async () => {
    expect(await resolveMoveList(null, { client: mockSb() })).toBeNull();
    expect(await resolveMoveList({}, { client: mockSb() })).toBeNull();
  });

  test('a DB error surfaces (not swallowed) so the caller can log + skip fidelity', async () => {
    const sb = mockSb({ data: null, error: new Error('boom') });
    await expect(resolveMoveList({ lesson_id: 'L', version_stamp: 'v', content_hash: 'h' }, { client: sb })).rejects.toThrow('boom');
  });

  test('upsert keys on the UNIQUE (lesson_id, version_stamp, content_hash)', async () => {
    const sb = mockSb({ data: { id: 'uuid1' }, error: null });
    await upsertMoveList({ lesson_id: 'L', version_stamp: 'v', content_hash: 'h', moves: MOVES, n_moves: 1 }, { client: sb });
    expect(sb.calls.from[0]).toBe(TABLE);
    expect(sb.calls.upsert.optsArg).toEqual({ onConflict: 'lesson_id,version_stamp,content_hash' });
    expect(sb.calls.upsert.payload.moves).toEqual(MOVES);
    expect(sb.calls.upsert.payload.updated_at).toBeTruthy();
  });
});
