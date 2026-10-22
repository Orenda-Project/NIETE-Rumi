'use strict';
/**
 * bd-c5reix — a teacher's classroom recording sent on WhatsApp is KEPT for the app.
 *
 * Since 19 Oct a teacher on the teacher app who sends a lesson of 15 minutes or more gets the app link instead of
 * coaching, and the recording was dropped (1,073 recordings from 395 teachers, 20-22 Oct; 44% came back to the app).
 * Now the bot saves it under the portal's own audio tree before the link goes, and the app shows it waiting:
 *
 *   AC1  saved at classroom_audio/<uid>/<YYYY-MM>/portal_wa-… with sha256 + duration metadata, BEFORE the link
 *   AC2  a save that fails still sends today's link
 *   AC4  the same bytes as an analysed DC observation of hers: nothing saved, the "sent before" link;
 *        the same bytes as one still waiting: no second copy
 *   AC5  the waiting list: hers, unsent, at most 7 days old, newest first, one per recording, with a listen link and
 *        what it duplicates — never another teacher's, never one already sent, never an app upload
 *
 * Driven through the real service with R2 and Supabase as in-memory doubles that filter the way PostgREST does.
 */

const crypto = require('crypto');

const SERVICE = '../../bot/shared/services/coaching/whatsapp-recording.service';
const PORTAL = '../../bot/shared/services/coaching/portal-coaching.service';

const ME = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const OTHER = '9a9a9a9a-0000-4000-8000-000000000000';
const NOW = new Date('2026-10-22T10:00:00Z');
const BYTES = Buffer.from('forty minutes of a grade 4 science lesson');
const SHA = crypto.createHash('sha256').update(BYTES).digest('hex');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const url = (key) => `https://r2.example/bucket/${key}`;
const waKey = (uid, ym, sha, id, ext = '.ogg') => `classroom_audio/${uid}/${ym}/portal_wa-${sha.slice(0, 16)}-${id}${ext}`;

/** A PostgREST double over `rows[table]`: eq / in / is / not in / order, awaited or maybeSingle. */
function fakeSupabase(rows) {
  const from = (table) => {
    const tests = [];
    let order = null;
    const run = () => {
      let out = (rows[table] || []).filter((r) => tests.every((t) => t(r)));
      if (order) out = [...out].sort((a, b) => (a[order] < b[order] ? 1 : -1));
      return out;
    };
    const q = {
      select: () => q,
      eq: (c, v) => { tests.push((r) => r[c] === v); return q; },
      neq: (c, v) => { tests.push((r) => r[c] !== v); return q; },
      in: (c, vs) => { tests.push((r) => vs.includes(r[c])); return q; },
      is: (c, v) => { tests.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      not: (c, op, v) => {
        const vs = String(v).replace(/[()]/g, '').split(',');
        tests.push((r) => !vs.includes(r[c]));
        return q;
      },
      order: (c) => { order = c; return q; },
      limit: () => q,
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return q;
  };
  return { from };
}

/** An in-memory R2: objects by key, with their upload time and metadata. */
function fakeR2(objects = {}) {
  const store = { ...objects };
  return {
    store,
    uploadBuffer: jest.fn(async (buffer, key, contentType, opts = {}) => {
      store[key] = { lastModified: NOW, size: buffer.length, contentType, metadata: opts.metadata || {} };
      return url(key);
    }),
    listObjects: jest.fn(async (prefix) => Object.entries(store)
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, o]) => ({ key, lastModified: o.lastModified, size: o.size }))),
    headObject: jest.fn(async (key) => (store[key]
      ? { exists: true, sizeBytes: store[key].size, contentType: store[key].contentType, metadata: store[key].metadata }
      : { exists: false })),
    getPresignedGetUrl: jest.fn(async (key) => `https://r2.example/get/${key}?sig=1`),
    buildR2PublicUrl: url,
  };
}

function deps({ rows = {}, objects = {}, ...rest } = {}) {
  return {
    supabase: fakeSupabase({ coaching_sessions: [], ...rows }),
    r2: fakeR2(objects),
    now: () => NOW,
    newId: () => 'b2c3d4e5-0000-4000-8000-000000000001',
    log: jest.fn(),
    tk: (id) => `tk-${id}`,
    ...rest,
  };
}

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

describe('keepRecording — the door saves her recording for the app (AC1)', () => {
  test('saves the bytes under her portal audio tree, marked as from WhatsApp, with the hash and the length', async () => {
    const d = deps();
    const out = await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg; codecs=opus', seconds: 1812, door: 'voice' }, d);

    expect(out).toEqual({ status: 'saved', key: waKey(ME, '2026-10', SHA, 'b2c3d4e5-0000-4000-8000-000000000001'), sha256: SHA });
    expect(d.r2.uploadBuffer).toHaveBeenCalledTimes(1);
    const [buffer, key, contentType, opts] = d.r2.uploadBuffer.mock.calls[0];
    expect(buffer).toBe(BYTES);
    expect(key).toBe(out.key);
    expect(contentType).toBe('audio/ogg');
    expect(opts.metadata).toEqual({ sha256: SHA, duration: '1812', door: 'voice', receivedAt: NOW.toISOString() });
  });

  test('the saved key is one the app may send: her own, an audio upload, a portal row', async () => {
    const out = await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/mpeg', filename: 'lesson.mp3', seconds: 2400, door: 'document' }, deps());
    const Portal = require(PORTAL);
    expect(Portal.isOwnPortalKey(ME, out.key, 'audio')).toBe(true);
    expect(Portal.isOwnPortalKey(OTHER, out.key, 'audio')).toBe(false);
    expect(Portal.isPortalTeacherSession({ audio_url: url(out.key), observation_type: null })).toBe(true);
    expect(Svc.isWhatsAppKey(out.key)).toBe(true);
    expect(out.key.endsWith('.mp3')).toBe(true);
  });

  test('a file name the app takes wins over its media type; a format the app cannot take is not saved', async () => {
    const d = deps();
    const m4a = await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'application/octet-stream', filename: 'Class 4.M4A', door: 'document' }, d);
    expect(m4a.key.endsWith('.m4a')).toBe(true);
    const flac = await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/flac', filename: 'x.flac', door: 'document' }, deps());
    expect(flac).toEqual({ status: 'invalid', reason: 'not_audio' });
  });
});

describe('keepRecording — the same recording again (AC4)', () => {
  test('the same bytes as an analysed DC observation of hers: nothing saved, a repeat', async () => {
    const d = deps({ rows: { coaching_sessions: [
      { id: 'cs-old', user_id: ME, audio_hash: SHA, status: 'completed', observation_type: null, created_at: '2026-09-30T08:00:00Z' },
    ] } });
    const out = await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg', seconds: 1800, door: 'voice' }, d);
    expect(out).toEqual({ status: 'repeat', sessionId: 'cs-old', sha256: SHA });
    expect(d.r2.uploadBuffer).not.toHaveBeenCalled();
  });

  test('another teacher\'s session with the same bytes is not hers: saved', async () => {
    const d = deps({ rows: { coaching_sessions: [
      { id: 'cs-x', user_id: OTHER, audio_hash: SHA, status: 'completed', observation_type: null, created_at: '2026-09-30T08:00:00Z' },
    ] } });
    expect((await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, d)).status).toBe('saved');
  });

  test('the same bytes still waiting for her: no second copy, the waiting one is named', async () => {
    const waiting = waKey(ME, '2026-10', SHA, 'aaaa');
    const d = deps({ objects: { [waiting]: { lastModified: daysAgo(1), size: BYTES.length, metadata: { sha256: SHA } } } });
    const out = await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, d);
    expect(out).toEqual({ status: 'waiting', key: waiting, sha256: SHA });
    expect(d.r2.uploadBuffer).not.toHaveBeenCalled();
  });

  test('the same bytes she already sent from the app (still being analysed): a repeat, nothing saved', async () => {
    const sentKey = waKey(ME, '2026-10', SHA, 'aaaa');
    const d = deps({
      objects: { [sentKey]: { lastModified: daysAgo(1), size: BYTES.length, metadata: { sha256: SHA } } },
      rows: { coaching_sessions: [{ id: 'cs-now', user_id: ME, audio_url: url(sentKey), status: 'analyzing', observation_type: null }] },
    });
    expect(await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, d))
      .toEqual({ status: 'repeat', sessionId: 'cs-now', sha256: SHA });
    expect(d.r2.uploadBuffer).not.toHaveBeenCalled();
  });

  test('a copy sent once whose analysis never ran (failed) is still waiting: named, no second copy', async () => {
    const sentKey = waKey(ME, '2026-10', SHA, 'aaaa');
    const d = deps({
      objects: { [sentKey]: { lastModified: daysAgo(1), size: BYTES.length, metadata: { sha256: SHA } } },
      rows: { coaching_sessions: [{ id: 'cs-f', user_id: ME, audio_url: url(sentKey), status: 'failed', observation_type: null }] },
    });
    const out = await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, d);
    expect(out).toEqual({ status: 'waiting', key: sentKey, sha256: SHA });
    expect(d.r2.uploadBuffer).not.toHaveBeenCalled();
  });

  test('a waiting copy older than 7 days no longer waits: a fresh copy is saved', async () => {
    const stale = waKey(ME, '2026-10', SHA, 'aaaa');
    const d = deps({ objects: { [stale]: { lastModified: daysAgo(8), size: BYTES.length, metadata: { sha256: SHA } } } });
    expect((await Svc.__internals.keepRecording({ userId: ME, buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, d)).status).toBe('saved');
  });
});

describe('pendingRecordings — what waits for her in the app (AC5)', () => {
  const A = Buffer.from('lesson A');
  const B = Buffer.from('lesson B');
  const shaA = crypto.createHash('sha256').update(A).digest('hex');
  const shaB = crypto.createHash('sha256').update(B).digest('hex');
  const obj = (sha, at, seconds = 1800) => ({ lastModified: at, size: 10, metadata: { sha256: sha, duration: String(seconds) } });

  test('hers, unsent, newest first, each with its length, when it came and a listen link', async () => {
    const kA = waKey(ME, '2026-10', shaA, 'a1');
    const kB = waKey(ME, '2026-09', shaB, 'b1', '.m4a');
    const d = deps({ objects: { [kA]: obj(shaA, daysAgo(2), 1812), [kB]: obj(shaB, daysAgo(1), 2400) } });
    const out = await Svc.pendingRecordings({ userId: ME }, d);
    expect(out.status).toBe('ok');
    expect(out.recordings.map((r) => r.key)).toEqual([kB, kA]);
    expect(out.recordings[0]).toEqual({
      key: kB, id: `portal_wa-${shaB.slice(0, 16)}-b1`, seconds: 2400, receivedAt: daysAgo(1).toISOString(),
      listenUrl: `https://r2.example/get/${kB}?sig=1`, duplicateOf: null,
    });
  });

  test('never one she already sent, one older than 7 days, an app upload, or another teacher\'s', async () => {
    const sent = waKey(ME, '2026-10', shaA, 'sent');
    const old = waKey(ME, '2026-10', shaB, 'old');
    const appUpload = `classroom_audio/${ME}/2026-10/portal_9f1e.webm`;
    const theirs = waKey(OTHER, '2026-10', shaA, 't1');
    const d = deps({
      objects: {
        [sent]: obj(shaA, daysAgo(1)), [old]: obj(shaB, daysAgo(9)),
        [appUpload]: obj(shaA, daysAgo(1)), [theirs]: obj(shaA, daysAgo(1)),
      },
      rows: { coaching_sessions: [{ id: 'cs-s', user_id: ME, audio_url: url(sent), status: 'completed', observation_type: null }] },
    });
    expect((await Svc.pendingRecordings({ userId: ME }, d)).recordings).toEqual([]);
  });

  test('the same bytes saved twice is shown once, the newest copy', async () => {
    const first = waKey(ME, '2026-10', shaA, 'first');
    const second = waKey(ME, '2026-10', shaA, 'second');
    const d = deps({ objects: { [first]: obj(shaA, daysAgo(3)), [second]: obj(shaA, daysAgo(1)) } });
    expect((await Svc.pendingRecordings({ userId: ME }, d)).recordings.map((r) => r.key)).toEqual([second]);
  });

  test('a waiting recording she has already sent the same bytes of names that DC observation', async () => {
    const k = waKey(ME, '2026-10', shaA, 'a1');
    const d = deps({
      objects: { [k]: obj(shaA, daysAgo(1)) },
      rows: { coaching_sessions: [
        { id: 'cs-a', user_id: ME, audio_hash: shaA, status: 'completed', observation_type: null, created_at: '2026-10-01T09:00:00Z' },
        { id: 'cs-obs', user_id: ME, audio_hash: shaA, status: 'completed', observation_type: 'leader_observation', created_at: '2026-10-05T09:00:00Z' },
      ] },
    });
    const [rec] = (await Svc.pendingRecordings({ userId: ME }, d)).recordings;
    expect(rec.duplicateOf).toEqual({ sessionId: 'cs-a', date: '2026-10-01T09:00:00Z', ready: true });
  });

  test('none at all is an empty list, not an error', async () => {
    expect(await Svc.pendingRecordings({ userId: ME }, deps())).toEqual({ status: 'ok', recordings: [] });
  });

  test('no user is refused', async () => {
    expect(await Svc.pendingRecordings({}, deps())).toEqual({ status: 'invalid', reason: 'no_user' });
  });
});

describe('checkDuplicate — has she sent these bytes before? (the app asks before it uploads)', () => {
  test('her own DC observation over the same bytes', async () => {
    const d = deps({ rows: { coaching_sessions: [
      { id: 'cs-a', user_id: ME, audio_hash: SHA, status: 'analyzing', observation_type: null, created_at: '2026-10-20T09:00:00Z' },
    ] } });
    expect(await Svc.checkDuplicate({ userId: ME, sha256: SHA }, d))
      .toEqual({ status: 'ok', duplicateOf: { sessionId: 'cs-a', date: '2026-10-20T09:00:00Z', ready: false } });
  });

  test('another teacher\'s, an observation, or one that never ran is not a duplicate', async () => {
    const d = deps({ rows: { coaching_sessions: [
      { id: 'x1', user_id: OTHER, audio_hash: SHA, status: 'completed', observation_type: null, created_at: '2026-10-20T09:00:00Z' },
      { id: 'x2', user_id: ME, audio_hash: SHA, status: 'completed', observation_type: 'leader_observation', created_at: '2026-10-20T09:00:00Z' },
      { id: 'x3', user_id: ME, audio_hash: SHA, status: 'failed', observation_type: null, created_at: '2026-10-20T09:00:00Z' },
    ] } });
    expect(await Svc.checkDuplicate({ userId: ME, sha256: SHA }, d)).toEqual({ status: 'ok', duplicateOf: null });
  });

  test('a hash that is not a sha256 is refused', async () => {
    expect(await Svc.checkDuplicate({ userId: ME, sha256: 'abc' }, deps())).toEqual({ status: 'invalid', reason: 'bad_hash' });
  });
});

describe('redirectClassroomRecording — the door, end to end (AC1, AC2, AC4)', () => {
  /** redirectIfFlagged as the teacher-link branch runs it: onLink first, then the link it shapes. */
  function linkRedirect(order) {
    return {
      redirectIfFlagged: jest.fn(async (feature, args) => {
        const shape = await args.onLink({ journey: { journeyId: 'j-123', feature } });
        order.push(['link', shape]);
        return true;
      }),
    };
  }

  test('saved BEFORE the link goes, and the link opens the one screen with it attached', async () => {
    const order = [];
    const d = deps({ redirect: linkRedirect(order) });
    d.r2.uploadBuffer.mockImplementation(async (buffer, key) => { order.push(['saved', key]); return url(key); });
    const handled = await Svc.redirectClassroomRecording({
      userId: ME, from: '+92300FIXTURE1', language: 'ur', reason: 'classroom_audio', buffer: BYTES, mimeType: 'audio/ogg', seconds: 1812, door: 'voice',
    }, d);
    expect(handled).toBe(true);
    expect(order.map(([what]) => what)).toEqual(['saved', 'link']);
    expect(order[1][1]).toEqual({ landing: 'ai_coaching_recording' });
    expect(d.redirect.redirectIfFlagged).toHaveBeenCalledWith('ai_coaching', expect.objectContaining({
      userId: ME, from: '+92300FIXTURE1', language: 'ur', reason: 'classroom_audio', onLink: expect.any(Function),
    }));
    expect(d.log).toHaveBeenCalledWith('app_funnel.recording_saved', expect.objectContaining({
      event: 'app_funnel.recording_saved', journeyId: 'j-123', tk: `tk-${ME}`, door: 'voice', how: 'new',
    }));
  });

  test('no bytes in hand (a voice note WhatsApp gave a length for): downloaded once, then saved', async () => {
    const downloadMedia = jest.fn(async () => BYTES);
    const d = deps({ redirect: linkRedirect([]), downloadMedia });
    await Svc.redirectClassroomRecording({ userId: ME, from: 'f', reason: 'classroom_audio', mediaId: 'media-1', mimeType: 'audio/ogg', seconds: 1800, door: 'voice' }, d);
    expect(downloadMedia).toHaveBeenCalledTimes(1);
    expect(downloadMedia).toHaveBeenCalledWith('media-1');
    expect(d.r2.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  test('sent before: nothing saved, the link says so (its own words) and opens Digital Coaching', async () => {
    const order = [];
    const d = deps({ redirect: linkRedirect(order), rows: { coaching_sessions: [
      { id: 'cs-old', user_id: ME, audio_hash: SHA, status: 'completed', observation_type: null, created_at: '2026-09-30T08:00:00Z' },
    ] } });
    await Svc.redirectClassroomRecording({ userId: ME, from: 'f', reason: 'classroom_audio', buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, d);
    expect(d.r2.uploadBuffer).not.toHaveBeenCalled();
    expect(order[0][1]).toEqual({ copy: ['appLinkBodyCoachingRepeat', 'appLinkButtonCoachingRepeat'] });
    expect(d.log).toHaveBeenCalledWith('app_funnel.recording_duplicate', expect.objectContaining({ journeyId: 'j-123', coachingSessionId: 'cs-old' }));
  });

  test('AC2 — the save fails: today\'s link still goes (no landing, no copy), nothing throws, a warning is logged', async () => {
    const order = [];
    const d = deps({ redirect: linkRedirect(order) });
    d.r2.uploadBuffer.mockRejectedValue(new Error('R2 down'));
    await expect(Svc.redirectClassroomRecording({ userId: ME, from: 'f', reason: 'classroom_audio', buffer: BYTES, mimeType: 'audio/ogg', door: 'voice' }, d))
      .resolves.toBe(true);
    expect(order[0][1]).toBeNull();
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/could not be kept/), expect.objectContaining({ error: 'R2 down' }), 'warn');
    expect(d.log).toHaveBeenCalledWith('app_funnel.recording_save_failed', expect.objectContaining({ why: 'error' }));
  });

  test('AC2 — the download fails: today\'s link still goes', async () => {
    const order = [];
    const d = deps({ redirect: linkRedirect(order), downloadMedia: jest.fn().mockRejectedValue(new Error('Meta 404')) });
    await expect(Svc.redirectClassroomRecording({ userId: ME, from: 'f', reason: 'classroom_audio', mediaId: 'm', door: 'voice' }, d)).resolves.toBe(true);
    expect(order[0][1]).toBeNull();
  });

  test('AC3 — no link for her (the WhatsApp flow, or the Play Store notice): nothing is downloaded or saved', async () => {
    const downloadMedia = jest.fn(async () => BYTES);
    const redirect = { redirectIfFlagged: jest.fn(async () => false) };
    const d = deps({ redirect, downloadMedia });
    expect(await Svc.redirectClassroomRecording({ userId: ME, from: 'f', reason: 'classroom_audio', mediaId: 'm', door: 'voice' }, d)).toBe(false);
    expect(downloadMedia).not.toHaveBeenCalled();
    expect(d.r2.uploadBuffer).not.toHaveBeenCalled();
  });
});
