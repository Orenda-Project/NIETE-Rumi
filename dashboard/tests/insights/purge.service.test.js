'use strict';
/**
 * Retention A (bd-sex15q.36; NIGHTLY_JOB §10, INSIGHTS_SCHEMA §4): `--purge-clips` deletes a session's clips and its
 * whole-lesson MP3 a year (365 days; 8 weeks before 28 Oct) after the last window that showed it closed, marks its moments `expired`, writes one audit
 * row per run, and never touches a key outside the tier's own prefixes. R2 is a mock at the S3 boundary; the store is
 * the MemoryStore; the CLI test runs `main()` with supabase-js and the S3 client mocked at the network boundary.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../../lib/insights/constants');
const { MemoryStore } = require('../../lib/insights/store');

jest.mock('@aws-sdk/client-s3', () => {
  class Cmd { constructor(input) { this.input = input; } }
  class ListObjectsV2Command extends Cmd {}
  class DeleteObjectCommand extends Cmd {}
  class GetObjectCommand extends Cmd {}
  class PutObjectCommand extends Cmd {}
  class HeadObjectCommand extends Cmd {}
  class S3Client { send(cmd) { return global.__purgeR2.send(cmd); } }
  return { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, HeadObjectCommand };
});
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => require('../../lib/insights/store').memoryClient(global.__purgeTables),
}));

const purge = require('../../lib/insights/purge');
const cli = require('../../jobs/coachip-nightly');

const OLD = '00000000-0000-4000-8000-0000000000a1'; // recorded Mon 1 Jun 2026: its last 8-week window is on screen until Sun 2 Aug
const NEW = '00000000-0000-4000-8000-0000000000b2'; // recorded Mon 7 Sep 2026: still on screen
const LOST = '00000000-0000-4000-8000-0000000000c3'; // objects in R2, no fact row
const ACTOR = '00000000-0000-4000-8000-0000000000ee';
const CLOSE_OLD = '2026-08-02';
const day = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** An R2 mock: objects per bucket; lists by prefix (or, `rogue`, ignores the prefix); records every call. */
function r2(objects, { rogue = false } = {}) {
  const store = new Map(Object.entries(objects).map(([b, keys]) => [b, new Set(keys)]));
  const calls = [];
  return {
    calls,
    has: (b, k) => store.has(b) && store.get(b).has(k),
    async listObjectsV2({ Bucket, Prefix, ContinuationToken }) {
      calls.push(['list', Bucket, Prefix]);
      const all = [...(store.get(Bucket) || [])].filter((k) => rogue || k.startsWith(Prefix)).sort();
      const from = ContinuationToken ? Number(ContinuationToken) : 0;
      const page = all.slice(from, from + 2);
      const more = from + 2 < all.length;
      return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? String(from + 2) : undefined };
    },
    async deleteObject({ Bucket, Key }) {
      calls.push(['delete', Bucket, Key]);
      if (store.has(Bucket)) store.get(Bucket).delete(Key);
      return {};
    },
  };
}

const clipsOf = (env, s) => [`coachip/clips/${env}/${s}/600-660.mp3`, `coachip/clips/${env}/${s}/1200-1245.mp3`, `coachip/full/${env}/${s}.mp3`];

function seed({ circleWeek = null, openStep = false } = {}) {
  const store = new MemoryStore();
  store.rows('coachip_session_facts').push(
    { id: 'f-old', session_id: OLD, recorded_at: '2026-06-01T05:00:00.000Z' },
    { id: 'f-old-2', session_id: OLD, recorded_at: '2026-06-01T05:00:00.000Z' },
    { id: 'f-new', session_id: NEW, recorded_at: '2026-09-07T05:00:00.000Z' },
  );
  store.rows('coachip_moments').push(
    { id: 'm-old-1', fact_id: 'f-old', session_id: OLD, clip_status: 'ready', clip_r2_key: `coachip/clips/sandbox/${OLD}/600-660.mp3` },
    { id: 'm-old-2', fact_id: 'f-old-2', session_id: OLD, clip_status: 'ready', clip_r2_key: `coachip/clips/sandbox/${OLD}/1200-1245.mp3` },
    { id: 'm-new', fact_id: 'f-new', session_id: NEW, clip_status: 'ready', clip_r2_key: `coachip/clips/sandbox/${NEW}/600-660.mp3` },
  );
  if (circleWeek) store.rows('coachip_circle_items').push({ id: 'c-1', moment_id: 'm-old-1', week_start: circleWeek, sector: 'Tarnol' });
  if (openStep) store.rows('coachip_steps').push({ id: 's-1', source_moment_id: 'm-old-2', source_session_id: OLD, status: 'open' });
  store.calls.length = 0;
  return store;
}

const base = (over) => ({ envName: 'sandbox', bucket: 'rumi-sandbox', dryRun: false, actorUserId: ACTOR, log: () => {}, ...over });

describe('the window calendar', () => {
  test('a session is on screen until the end of the week its last 8-week window is held for', () => {
    expect(purge.lastWindowClose('2026-06-01')).toBe(CLOSE_OLD); // window 1 Jun-26 Jul, held the week of 27 Jul
    expect(purge.lastWindowClose('2026-06-02')).toBe(CLOSE_OLD);
    expect(purge.lastWindowClose('2026-06-07')).toBe(CLOSE_OLD);
    expect(purge.lastWindowClose('2026-06-08')).toBe('2026-08-09');
  });
  test('keys: only the tier\'s own clip and full shapes parse', () => {
    expect(purge.parseKey('sandbox', `coachip/clips/sandbox/${OLD}/600-660.mp3`)).toEqual({ kind: 'clip', sessionId: OLD });
    expect(purge.parseKey('sandbox', `coachip/full/sandbox/${OLD}.mp3`)).toEqual({ kind: 'full', sessionId: OLD });
    expect(purge.parseKey('staging', `coachip/clips/production/${OLD}/600-660.mp3`)).toBe(null);
    expect(purge.parseKey('sandbox', `classroom_audio/${OLD}/x.webm`)).toBe(null);
    expect(purge.parseKey('sandbox', `coachip/clips/sandbox/${OLD}/../../production/x.mp3`)).toBe(null);
  });
});

describe('one year (operator 28 Oct: "keep them for a year or so")', () => {
  test('364 days after the window closed: kept; 366 days after: purged', async () => {
    expect(purge.RETENTION_DAYS).toBe(365);
    const keptStore = seed();
    const s3k = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
    const kept = await purge.runPurge(base({ s3: s3k, store: keptStore, today: day(CLOSE_OLD, 364) }));
    expect(kept).toMatchObject({ sessions_purged: 0, sessions_kept: 1, retention_days: 365 });
    expect(s3k.calls.filter((c) => c[0] === 'delete')).toEqual([]);
    const goneStore = seed();
    const s3g = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
    const gone = await purge.runPurge(base({ s3: s3g, store: goneStore, today: day(CLOSE_OLD, 366) }));
    expect(gone).toMatchObject({ sessions_purged: 1, objects_deleted: 3 });
  });
});

describe('runPurge', () => {
  test('366 days after the window closed: the clips and the full MP3 are deleted, the moments expire, one audit row', async () => {
    const store = seed();
    const s3 = r2({ 'rumi-sandbox': [...clipsOf('sandbox', OLD), ...clipsOf('sandbox', NEW)] });
    const out = await purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, 366) }));
    for (const k of clipsOf('sandbox', OLD)) expect(s3.has('rumi-sandbox', k)).toBe(false);
    for (const k of clipsOf('sandbox', NEW)) expect(s3.has('rumi-sandbox', k)).toBe(true);
    const ms = store.rows('coachip_moments');
    expect(ms.filter((m) => m.session_id === OLD).map((m) => [m.clip_status, m.clip_r2_key])).toEqual([['expired', null], ['expired', null]]);
    expect(ms.find((m) => m.id === 'm-new').clip_status).toBe('ready');
    const audit = store.rows('coachip_audit_log');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: ACTOR, action: 'clip_purge', subject_id: out.run_id });
    expect(out).toMatchObject({ dry_run: false, sessions_listed: 2, sessions_purged: 1, objects_deleted: 3, moments_expired: 2, foreign_keys: 0 });
  });

  test('364 and 365 days after: kept, nothing deleted, nothing marked', async () => {
    for (const n of [364, 365]) {
      const store = seed();
      const s3 = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
      const out = await purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, n) }));
      expect(s3.calls.filter((c) => c[0] === 'delete')).toEqual([]);
      expect(store.rows('coachip_moments').every((m) => m.clip_status === 'ready')).toBe(true);
      expect(out).toMatchObject({ sessions_purged: 0, sessions_kept: 1 });
    }
  });

  test('a session re-shown in a newer window (the circle) is kept until that window has been closed a year', async () => {
    const store = seed({ circleWeek: '2026-08-10' }); // the circle week 10-16 Aug
    const s3 = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
    const kept = await purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, 366) }));
    expect(kept.sessions_purged).toBe(0);
    expect(s3.calls.filter((c) => c[0] === 'delete')).toEqual([]);
    const gone = await purge.runPurge(base({ s3, store, today: day('2026-08-16', 366) }));
    expect(gone.sessions_purged).toBe(1);
  });

  test('an open step set from one of the session\'s moments keeps it', async () => {
    const store = seed({ openStep: true });
    const s3 = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
    const out = await purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, 200) }));
    expect(out.sessions_purged).toBe(0);
    expect(s3.calls.filter((c) => c[0] === 'delete')).toEqual([]);
  });

  test('objects with no fact row are kept and counted, never guessed at', async () => {
    const store = seed();
    const s3 = r2({ 'rumi-sandbox': clipsOf('sandbox', LOST) });
    const out = await purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, 400) }));
    expect(out).toMatchObject({ sessions_unknown: 1, sessions_purged: 0 });
    expect(s3.calls.filter((c) => c[0] === 'delete')).toEqual([]);
  });

  test('a staging run in the bucket staging shares with production cannot delete a production key or a recording', async () => {
    const store = seed();
    const shared = { 'digital-coach-audio': [...clipsOf('production', OLD), `classroom_audio/${OLD}/rec.webm`, ...clipsOf('staging', OLD)] };
    const s3 = r2(shared, { rogue: true }); // a listing that ignores the prefix: the per-key guard must hold on its own
    const buckets = { sandbox: 'rumi-sandbox', staging: 'digital-coach-audio', production: 'digital-coach-audio' };
    const out = await purge.runPurge(base({ envName: 'staging', bucket: 'digital-coach-audio', buckets, s3, store, today: day(CLOSE_OLD, 366) }));
    const deleted = s3.calls.filter((c) => c[0] === 'delete').map((c) => c[2]);
    expect(deleted.sort()).toEqual(clipsOf('staging', OLD).sort());
    for (const k of clipsOf('production', OLD)) expect(s3.has('digital-coach-audio', k)).toBe(true);
    expect(s3.has('digital-coach-audio', `classroom_audio/${OLD}/rec.webm`)).toBe(true);
    expect(out.foreign_keys).toBe(4);
    expect([...new Set(s3.calls.filter((c) => c[0] === 'list').map((c) => c[2]))]).toEqual(['coachip/clips/staging/', 'coachip/full/staging/']); // paged
  });

  test('refusals: another tier\'s bucket, an unset bucket, production writes, no actor; nothing listed or deleted', async () => {
    const s3 = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
    const today = day(CLOSE_OLD, 366);
    await expect(purge.runPurge(base({ s3, store: seed(), today, bucket: 'digital-coach-audio' }))).rejects.toThrow(purge.PurgeRefusal);
    await expect(purge.runPurge(base({ s3, store: seed(), today, envName: 'staging', bucket: 'x', buckets: { staging: null } }))).rejects.toThrow(purge.PurgeRefusal);
    await expect(purge.runPurge(base({ s3, store: seed(), today, envName: 'production', bucket: 'digital-coach-audio',
      buckets: { production: 'digital-coach-audio' } }))).rejects.toThrow(/prod/);
    await expect(purge.runPurge(base({ s3, store: seed(), today, actorUserId: null }))).rejects.toThrow(/actor/);
    expect(s3.calls).toEqual([]);
  });

  test('a dry run lists and counts, deletes nothing and writes no row', async () => {
    const store = seed();
    const s3 = r2({ 'rumi-sandbox': [...clipsOf('sandbox', OLD), ...clipsOf('sandbox', NEW)] });
    const out = await purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, 366), dryRun: true, actorUserId: null }));
    expect(s3.calls.filter((c) => c[0] !== 'list')).toEqual([]);
    expect(store.writes).toBe(0);
    expect(store.rows('coachip_audit_log')).toEqual([]);
    expect(out).toMatchObject({ dry_run: true, sessions_listed: 2, sessions_purged: 1, objects_deleted: 0, objects_to_delete: 3, moments_expired: 0, moments_to_expire: 2 });
  });

  test('the audit row is written before anything is deleted: when it cannot be written (V1.8.2 not applied), nothing goes', async () => {
    const store = seed();
    const insert = store.insert.bind(store);
    store.insert = async (table, list) => {
      if (table === 'coachip_audit_log') throw new Error('insert coachip_audit_log: invalid input value for enum coachip_audit_action');
      return insert(table, list);
    };
    const s3 = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
    await expect(purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, 366) }))).rejects.toThrow(/coachip_audit_log/);
    expect(s3.calls.filter((c) => c[0] === 'delete')).toEqual([]);
    expect(store.rows('coachip_moments').every((m) => m.clip_status === 'ready')).toBe(true);
  });

  test('a failed delete leaves that session\'s moments as they were, to be tried again the next night', async () => {
    const store = seed();
    const s3 = r2({ 'rumi-sandbox': clipsOf('sandbox', OLD) });
    s3.deleteObject = async () => { throw Object.assign(new Error('boom'), { name: 'InternalError' }); };
    const out = await purge.runPurge(base({ s3, store, today: day(CLOSE_OLD, 366) }));
    expect(store.rows('coachip_moments').filter((m) => m.session_id === OLD).every((m) => m.clip_status === 'ready')).toBe(true);
    expect(out).toMatchObject({ sessions_purged: 0, sessions_failed: 1 });
    expect(store.rows('coachip_audit_log')).toHaveLength(1);
  });
});

describe('the CLI reads --purge-clips', () => {
  const sandboxEnv = (dir) => ({ SUPABASE_URL: `https://${C.SANDBOX_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'k', COACHIP_ENV: 'sandbox',
    R2_ENDPOINT: 'https://r2.invalid', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'rumi-sandbox', _dir: dir });

  test('--purge-clips --stages purge --dry-run: lists through the S3 client, writes purge.json with counts only, deletes nothing', async () => {
    const store = seed();
    global.__purgeTables = Object.fromEntries([...store.tables]);
    const mock = r2({ 'rumi-sandbox': [...clipsOf('sandbox', OLD), ...clipsOf('sandbox', NEW)] });
    global.__purgeR2 = { send: (cmd) => (cmd.constructor.name === 'ListObjectsV2Command' ? mock.listObjectsV2(cmd.input) : mock.deleteObject(cmd.input)) };
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-purge-'));
    const lines = [];
    const code = await cli.main(['--date', day(CLOSE_OLD, 365), '--dry-run', '--purge-clips', '--stages', 'purge', '--out', out],
      sandboxEnv(out), (m) => lines.push(m));
    expect(code).toBe(0);
    expect(mock.calls.filter((c) => c[0] !== 'list')).toEqual([]);
    const counts = JSON.parse(fs.readFileSync(path.join(out, 'purge.json'), 'utf8'));
    expect(counts).toMatchObject({ dry_run: true, today: day(CLOSE_OLD, 366), sessions_purged: 1, objects_to_delete: 3 });
    expect(JSON.stringify(counts)).not.toMatch(/coachip\/|[0-9a-f]{8}-[0-9a-f]{4}-4000-8000/);
    expect(lines.some((l) => /^purge dry_run=1 /.test(l))).toBe(true);
    expect(lines.join('\n')).not.toMatch(/coachip\/(clips|full)/);
    fs.rmSync(out, { recursive: true, force: true });
  });

  test('a write-mode purge without COACHIP_PURGE_ACTOR_USER_ID exits 3 before any client is built', async () => {
    const lines = [];
    global.__purgeR2 = { send: () => { throw new Error('no S3 call expected'); } };
    const code = await cli.main(['--date', '2026-10-26', '--purge-clips'], sandboxEnv(null), (m) => lines.push(m));
    expect(code).toBe(3);
    expect(lines).toEqual(['purge_refused reason=no_actor']);
  });

  test('--stages purge needs --purge-clips', () => {
    expect(() => cli.parseArgs(['--stages', 'purge'])).toThrow(/purge-clips/);
    expect(cli.parseArgs(['--purge-clips', '--stages', 'purge'])).toMatchObject({ purgeClips: true, stages: ['purge'] });
  });
});
