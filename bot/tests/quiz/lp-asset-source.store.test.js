'use strict';
/**
 * PLAN R8 §2.2 (lane S) — `lp-asset-source.store.js`.
 *
 * The whole point of this store is that it refuses to guess. A teacher holds ONE
 * PDF; the quiz must be written from the slide script of THAT version and no
 * other. So `resolveSlideScript` is exact-version only — no "latest for this
 * lesson" fallback anywhere — and a miss is a null that lane D turns into the
 * `source_missing` failure rather than a quiz about a lesson plan nobody has.
 *
 * The supabase stub applies eq() as a REAL filter over fixtures (the `makeChain`
 * idiom from transcript-quiz-flow-endpoint.test.js). A resolver that forgot
 * `.eq('content_hash', …)` would return the wrong version here rather than only
 * in production.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));

const defaultSupabase = require('../../shared/config/supabase');
const Store = require('../../shared/services/quiz/lp-asset-source.store');

const LESSON = 'grade_2_math_ch3_seg4';
const STAMP = 'v8-2026-08-16';
const HASH_A = 'aaaa1111';
const HASH_B = 'bbbb2222';

const SCRIPT_A = { meta: { topic: 'Halves and quarters' }, iDo: { steps: [{ say: 'A half is one of two equal parts.' }] } };
const SCRIPT_B = { meta: { topic: 'Halves and quarters (re-render)' }, iDo: { steps: [{ say: 'changed' }] } };

function row(hash, script, extra = {}) {
  return {
    asset_id: `asset-${hash}`,
    lesson_id: LESSON,
    version_stamp: STAMP,
    content_hash: hash,
    slide_script: script,
    source_url: null,
    verified: 'upload',
    ...extra,
  };
}

/** A chain that really filters, like PostgREST would. */
function makeChain(rows, calls, writes) {
  let data = [...(rows || [])];
  const chain = {
    select: (cols) => { calls.push({ op: 'select', cols }); return chain; },
    eq: (f, v) => { calls.push({ op: 'eq', f, v }); data = data.filter((r) => r[f] === v); return chain; },
    order: () => { calls.push({ op: 'order' }); return chain; },
    limit: (n) => { calls.push({ op: 'limit', n }); data = data.slice(0, n); return chain; },
    upsert: (payload, opts) => { writes.push({ op: 'upsert', payload, opts }); data = [payload]; return chain; },
    single: async () => ({ data: data[0] || null, error: null }),
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}

function stub(rows) {
  const calls = [];
  const writes = [];
  const tables = [];
  const client = {
    from: (t) => { tables.push(t); return makeChain(rows, calls, writes); },
  };
  return { client, calls, writes, tables };
}

/** A client whose every read comes back as a PostgREST error. */
function errorClient(message) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    upsert: () => chain,
    maybeSingle: async () => ({ data: null, error: { message, code: '42P01' } }),
    single: async () => ({ data: null, error: { message, code: '42P01' } }),
    then: (resolve) => resolve({ data: null, error: { message, code: '42P01' } }),
  };
  return { from: () => chain };
}

describe('lp-asset-source.store — resolveSlideScript', () => {
  test('TABLE is the migration V1.5.2 table', () => {
    expect(Store.TABLE).toBe('niete_lp_asset_sources');
  });

  test('the exact version triple returns the script, its provenance and the asset id', async () => {
    const s = stub([row(HASH_A, SCRIPT_A)]);
    const out = await Store.resolveSlideScript(
      { lessonId: LESSON, versionStamp: STAMP, contentHash: HASH_A }, { client: s.client },
    );
    expect(out).toEqual({ slideScript: SCRIPT_A, verified: 'upload', assetId: `asset-${HASH_A}` });
    expect(s.tables).toEqual(['niete_lp_asset_sources']);
  });

  test('a row with a DIFFERENT content_hash is not returned — the teacher holds another PDF', async () => {
    const s = stub([row(HASH_B, SCRIPT_B)]);
    const out = await Store.resolveSlideScript(
      { lessonId: LESSON, versionStamp: STAMP, contentHash: HASH_A }, { client: s.client },
    );
    expect(out).toBeNull();
    // the filter was actually applied, not merely intended
    expect(s.calls).toContainEqual({ op: 'eq', f: 'content_hash', v: HASH_A });
  });

  test('a row with a different version_stamp is not returned', async () => {
    const s = stub([row(HASH_A, SCRIPT_A, { version_stamp: 'v8-2026-05-01' })]);
    const out = await Store.resolveSlideScript(
      { lessonId: LESSON, versionStamp: STAMP, contentHash: HASH_A }, { client: s.client },
    );
    expect(out).toBeNull();
    expect(s.calls).toContainEqual({ op: 'eq', f: 'version_stamp', v: STAMP });
  });

  test('another lesson\'s row is never returned', async () => {
    const s = stub([row(HASH_A, SCRIPT_A, { lesson_id: 'grade_5_english_ch1_seg1' })]);
    const out = await Store.resolveSlideScript(
      { lessonId: LESSON, versionStamp: STAMP, contentHash: HASH_A }, { client: s.client },
    );
    expect(out).toBeNull();
  });

  test('NO "latest" fallback — two other versions of the same lesson still resolve to null', async () => {
    const s = stub([
      row(HASH_B, SCRIPT_B, { ingested_at: '2026-09-20T00:00:00Z' }),
      row('cccc3333', SCRIPT_B, { version_stamp: 'v8-2026-09-01', ingested_at: '2026-09-21T00:00:00Z' }),
    ]);
    const out = await Store.resolveSlideScript(
      { lessonId: LESSON, versionStamp: STAMP, contentHash: HASH_A }, { client: s.client },
    );
    expect(out).toBeNull();
    expect(s.calls.some((c) => c.op === 'order')).toBe(false);
  });

  test('a key with no version and no hash asks the DB nothing and returns null', async () => {
    const s = stub([row(HASH_A, SCRIPT_A)]);
    const out = await Store.resolveSlideScript({ lessonId: LESSON }, { client: s.client });
    expect(out).toBeNull();
    expect(s.tables).toEqual([]);
  });

  test('a missing lessonId asks the DB nothing and returns null', async () => {
    const s = stub([row(HASH_A, SCRIPT_A)]);
    expect(await Store.resolveSlideScript(null, { client: s.client })).toBeNull();
    expect(await Store.resolveSlideScript({ versionStamp: STAMP, contentHash: HASH_A }, { client: s.client })).toBeNull();
    expect(s.tables).toEqual([]);
  });

  test('a hash alone (no version stamp) still resolves exactly — the hash IS the version', async () => {
    const s = stub([row(HASH_A, SCRIPT_A)]);
    const out = await Store.resolveSlideScript({ lessonId: LESSON, contentHash: HASH_A }, { client: s.client });
    expect(out.slideScript).toEqual(SCRIPT_A);
    expect(s.calls.some((c) => c.op === 'eq' && c.f === 'version_stamp')).toBe(false);
  });

  test('a DB error THROWS — it must never look like "no source for this version"', async () => {
    await expect(Store.resolveSlideScript(
      { lessonId: LESSON, versionStamp: STAMP, contentHash: HASH_A },
      { client: errorClient('relation "niete_lp_asset_sources" does not exist') },
    )).rejects.toMatchObject({ message: expect.stringContaining('niete_lp_asset_sources') });
  });

  test('with no injected client it uses the shared supabase config', async () => {
    const calls = [];
    const writes = [];
    defaultSupabase.from.mockImplementation(() => makeChain([row(HASH_A, SCRIPT_A)], calls, writes));
    const out = await Store.resolveSlideScript({ lessonId: LESSON, versionStamp: STAMP, contentHash: HASH_A });
    expect(out.assetId).toBe(`asset-${HASH_A}`);
    expect(defaultSupabase.from).toHaveBeenCalledWith('niete_lp_asset_sources');
  });
});

describe('lp-asset-source.store — upsertSource', () => {
  test('upserts on the UNIQUE version key, so a re-run is a no-op not a duplicate', async () => {
    const s = stub([]);
    const payload = {
      asset_id: 'asset-1', lesson_id: LESSON, version_stamp: STAMP, content_hash: HASH_A,
      slide_script: SCRIPT_A, source_url: null, verified: 'upload',
    };
    await Store.upsertSource(payload, { client: s.client });
    expect(s.writes).toHaveLength(1);
    expect(s.writes[0].opts).toEqual({ onConflict: 'lesson_id,version_stamp,content_hash' });
    expect(s.writes[0].payload).toMatchObject(payload);
    expect(s.tables).toEqual(['niete_lp_asset_sources']);
  });

  test('refuses a row with no asset_id, no version identity or no script — before touching the DB', async () => {
    const s = stub([]);
    const good = {
      asset_id: 'asset-1', lesson_id: LESSON, version_stamp: STAMP, content_hash: HASH_A,
      slide_script: SCRIPT_A, verified: 'upload',
    };
    for (const missing of ['asset_id', 'lesson_id', 'version_stamp', 'content_hash', 'slide_script', 'verified']) {
      const bad = { ...good };
      delete bad[missing];
      await expect(Store.upsertSource(bad, { client: s.client })).rejects.toThrow(missing);
    }
    expect(s.writes).toEqual([]);
  });

  test('a write error THROWS rather than reporting a silent success', async () => {
    await expect(Store.upsertSource({
      asset_id: 'asset-1', lesson_id: LESSON, version_stamp: STAMP, content_hash: HASH_A,
      slide_script: SCRIPT_A, verified: 'upload',
    }, { client: errorClient('permission denied for table niete_lp_asset_sources') }))
      .rejects.toMatchObject({ message: expect.stringContaining('permission denied') });
  });
});
