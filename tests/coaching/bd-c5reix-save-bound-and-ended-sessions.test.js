'use strict';
/**
 * bd-c5reix (review round) —
 *   1. the save is BOUNDED: a download or an R2 put that never answers must not hold the link back. After the bound,
 *      today's plain link goes and a warning is logged, as on any failed save.
 *   2. a session that ENDED without analysis (failed / cancelled / abandoned) does not use up her recording: it stays
 *      waiting in the app, and Submit takes it again. A live or completed session does use it.
 * The match is on the key as coaching_sessions.audio_url stores it: r2.buildR2PublicUrl(key), exact.
 */
const crypto = require('crypto');

const WA = '../../bot/shared/services/coaching/whatsapp-recording.service';
const PORTAL = '../../bot/shared/services/coaching/portal-coaching.service';
const ME = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const NOW = new Date('2026-10-22T10:00:00Z');
const BYTES = Buffer.from('a lesson she sent on WhatsApp');
const SHA = crypto.createHash('sha256').update(BYTES).digest('hex');
const KEY = `classroom_audio/${ME}/2026-10/portal_wa-${SHA.slice(0, 16)}-aaaa.ogg`;
const url = (key) => `https://r2.example/bucket/${key}`;

function fakeSupabase(rows) {
  const writes = { inserts: [] };
  const from = (table) => {
    const tests = [];
    const run = () => (rows[table] || []).filter((r) => tests.every((t) => t(r)));
    const q = {
      select: () => q,
      eq: (c, v) => { tests.push((r) => r[c] === v); return q; },
      in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return q; },
      is: (c, v) => { tests.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      not: (c, _op, v) => { const vs = String(v).replace(/[()]/g, '').split(','); tests.push((r) => !vs.includes(r[c])); return q; },
      or: () => q,
      order: () => q,
      limit: () => q,
      insert: (row) => { writes.inserts.push({ table, row }); q._inserted = row; return q; },
      update: () => q,
      single: async () => (q._inserted ? { data: { id: 'cs-new', ...q._inserted }, error: null } : { data: run()[0] || null, error: null }),
      maybeSingle: async () => ({ data: table === 'coaching_sessions' ? null : (run()[0] || null), error: null }),
      then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return q;
  };
  return { from, writes };
}
function r2(objects = {}) {
  return {
    uploadBuffer: jest.fn(async (_b, key) => url(key)),
    listObjects: jest.fn(async (prefix) => Object.entries(objects).filter(([k]) => k.startsWith(prefix))
      .map(([key, o]) => ({ key, lastModified: o.lastModified, size: 9 }))),
    headObject: jest.fn(async (key) => (objects[key] ? { exists: true, sizeBytes: 9, metadata: objects[key].metadata } : { exists: false })),
    getPresignedGetUrl: jest.fn(async (key) => `https://r2.example/get/${key}`),
    buildR2PublicUrl: url,
  };
}
const waiting = { [KEY]: { lastModified: new Date('2026-10-21T10:00:00Z'), metadata: { sha256: SHA, duration: '1812' } } };
const session = (status) => ({ id: `cs-${status}`, user_id: ME, audio_url: url(KEY), status, observation_type: null });

beforeEach(() => jest.resetModules());

describe('1 — the save is bounded', () => {
  test('a put that never answers: the link still goes, plain, and a warning says why', async () => {
    const Svc = require(WA);
    const log = jest.fn();
    const store = r2();
    store.uploadBuffer.mockImplementation(() => new Promise(() => {}));
    let shape = 'not called';
    const redirect = { redirectIfFlagged: jest.fn(async (_f, args) => { shape = await args.onLink({ journey: { journeyId: 'j_0123456789abcdef' } }); return true; }) };
    const started = Date.now();
    const handled = await Svc.redirectClassroomRecording({
      userId: ME, from: 'f', reason: 'classroom_audio', buffer: BYTES, mimeType: 'audio/ogg', door: 'voice',
    }, { supabase: fakeSupabase({ coaching_sessions: [] }), r2: store, now: () => NOW, log, tk: (id) => `tk-${id}`, redirect, saveTimeoutMs: 50 });
    expect(handled).toBe(true);
    expect(shape).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/not kept for the app in time/), expect.objectContaining({ ms: 50 }), 'warn');
    expect(log).toHaveBeenCalledWith('app_funnel.recording_save_failed', expect.objectContaining({ why: 'timeout' }));
  });

  test('a download that never answers: the same', async () => {
    const Svc = require(WA);
    let shape = 'not called';
    const redirect = { redirectIfFlagged: jest.fn(async (_f, args) => { shape = await args.onLink({}); return true; }) };
    await Svc.redirectClassroomRecording({ userId: ME, from: 'f', reason: 'classroom_audio', mediaId: 'm', door: 'voice' }, {
      supabase: fakeSupabase({ coaching_sessions: [] }), r2: r2(), now: () => NOW, log: jest.fn(), tk: (id) => id, redirect,
      downloadMedia: () => new Promise(() => {}), saveTimeoutMs: 50,
    });
    expect(shape).toBeNull();
  });

  test('the bound is about a minute by default', () => {
    expect(require(WA).SAVE_TIMEOUT_MS).toBe(60_000);
  });
});

describe('2 — a session that ended without analysis does not use up her recording', () => {
  test.each(['failed', 'cancelled', 'abandoned'])('only a %s session holds it: still waiting in the app', async (status) => {
    const out = await require(WA).pendingRecordings({ userId: ME }, {
      supabase: fakeSupabase({ coaching_sessions: [session(status)] }), r2: r2(waiting), now: () => NOW,
    });
    expect(out.recordings.map((r) => r.key)).toEqual([KEY]);
  });

  test.each(['analyzing', 'completed'])('a %s session holds it: no longer waiting', async (status) => {
    const out = await require(WA).pendingRecordings({ userId: ME }, {
      supabase: fakeSupabase({ coaching_sessions: [session('failed'), session(status)] }), r2: r2(waiting), now: () => NOW,
    });
    expect(out.recordings).toEqual([]);
  });

  test('sent again on WhatsApp after a failed run: the waiting copy is named, no second copy', async () => {
    const store = r2(waiting);
    const out = await require(WA).__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, {
      supabase: fakeSupabase({ coaching_sessions: [session('failed')] }), r2: store, now: () => NOW,
    });
    expect(out).toEqual({ status: 'waiting', key: KEY, sha256: SHA });
    expect(store.uploadBuffer).not.toHaveBeenCalled();
  });

  const start = (rows) => require(PORTAL).startPortalSession({ userId: ME, key: KEY }, {
    supabase: fakeSupabase({ users: [{ id: ME, phone_number: '+92300FIXTURE2' }], coaching_sessions: rows }),
    r2: { headObject: jest.fn(async () => ({ exists: true, sizeBytes: 9 })), buildR2PublicUrl: url },
    queue: { queueTranscription: jest.fn(async () => 'm') },
    now: () => NOW, newId: () => 'x', log: jest.fn(),
  });

  test.each(['failed', 'cancelled', 'abandoned'])('Submit after a %s run: started again', async (status) => {
    expect(await start([session(status)])).toEqual({ status: 'ok', coachingSessionId: 'cs-new' });
  });

  test.each(['analyzing', 'completed'])('Submit while a %s session holds it: 409 already_sent with that session', async (status) => {
    expect(await start([session('failed'), session(status)])).toEqual({ status: 'already_sent', coachingSessionId: `cs-${status}` });
  });
});
