'use strict';
/**
 * bd-sex15q.16 (m-player, server) — the two COACHIP media streams over HTTP, through m-api's real router and guards, the
 * real flag readers, scope and codec services, against a throwaway Postgres (contracts/API.md §10 R7, R8; §11 audit):
 *
 *   R7 GET /coachip/m/:momentId/clip         coach in scope → `clip`; RM with the moment in this week's circle → `circle_play`;
 *                                           anyone else the one 404; the stored clip, else the live cut, else 503
 *   R8 GET /coachip/session/:sessionId/audio coach only; the whole-lesson MP3 first, else the recording with its own type
 *
 * Only the network boundary is faked: the S3 send (a fictional object store) and openClip (no ffmpeg). Fictional rows
 * only (FIXTURES rules): fake v4 ids, "Govt. Primary School Fictional-NN", users.name null; a few filler bytes, no audio.
 */
const path = require('path');
const { PassThrough } = require('stream');
const { startPg, hasPostgres } = require('../coachip/helpers/pg-harness');
const seed = require('../coachip/helpers/seed');
const ins = require('../coachip/helpers/insights-seed');
const { startApp } = require('../coachip/helpers/app');
const { teacherKeyFor } = require('../../dashboard/services/coachip-codes.service');
const { createCoachipMediaRoutes } = require('../../dashboard/routes/portal-coachip-media.routes');
const { createClipService } = require('../../dashboard/services/coachip-clip.service');

// The root jest config maps the two AWS packages to stubs; the real ones (for a real 300 s signature) live in dashboard/node_modules.
const AWS = path.resolve(__dirname, '..', '..', 'dashboard', 'node_modules', '@aws-sdk');
const realS3 = require(path.join(AWS, 'client-s3'));
const { getSignedUrl: realGetSignedUrl } = require(path.join(AWS, 's3-request-presigner'));

const run = hasPostgres() ? describe : describe.skip;
const { fid } = seed;
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday 26 Oct 2026, 11:00 PKT
const P = '/api/portal/coachip';
const INVENTED = '00000000-0000-4000-8000-ff0000000001';

const CA = fid('coach', 1);
const CB = fid('coach', 2);
const RM = fid('rm', 1);        // Urban-I, the moment is in its circle
const RM2 = fid('rm', 2);       // Tarnol, nothing in its circle
const T1 = fid('teacher', 1);   // CA's teacher, at S-01
const T2 = fid('teacher', 2);   // CB's teacher, at S-02
const S1 = fid('school', 1);
const S2 = fid('school', 2);
const SESS1 = fid('session', 1);
const SESS2 = fid('session', 2);
const SESS3 = fid('session', 3);   // CA's teacher, no recording at all
const MOM_READY = fid('moment', 1);
const MOM_PENDING = fid('moment', 2);
const MOM_NOAUDIO = fid('moment', 3);

const HOST = 'fictional-account.r2.cloudflarestorage.com';
const BUCKET = 'fictional-bucket';
const recKey = (teacher, session) => `classroom_audio/${teacher}/2026-10/portal_${session}.webm`;
const recUrl = (teacher, session) => `https://${HOST}/${BUCKET}/${recKey(teacher, session)}`;
const CLIP_KEY = `coachip/clips/sandbox/${SESS1}/1100-1138.mp3`;
const FULL_KEY = `coachip/full/sandbox/${SESS1}.mp3`;
const ENV = {
  R2_ENDPOINT: `https://${HOST}`, R2_ACCESS_KEY_ID: 'FICTIONALKEYID0000', R2_SECRET_ACCESS_KEY: 'fictional-secret-0000000000000000000000',
  R2_BUCKET_NAME: BUCKET, COACHIP_ENV: 'sandbox',
};
const FILLER = (n, c) => Buffer.alloc(n, c);   // filler bytes, not audio

/** A fictional object store behind S3's send, with R2's Range answers. */
function fakeS3(store) {
  const calls = [];
  async function send(cmd) {
    const kind = cmd.constructor.name;
    const input = cmd.input;
    calls.push({ kind, ...input });
    const obj = store[`${input.Bucket}/${input.Key}`];
    if (!obj) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    if (obj.error) throw Object.assign(new Error(obj.error), { name: obj.error, $metadata: { httpStatusCode: 403 } });
    if (kind === 'HeadObjectCommand') return { ContentLength: obj.bytes.length, ContentType: obj.type };
    let slice = obj.bytes;
    let ContentRange;
    if (input.Range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(input.Range);
      const a = Number(m[1]);
      const b = m[2] === '' ? obj.bytes.length - 1 : Math.min(Number(m[2]), obj.bytes.length - 1);
      if (a >= obj.bytes.length) throw Object.assign(new Error('InvalidRange'), { name: 'InvalidRange', $metadata: { httpStatusCode: 416 } });
      slice = obj.bytes.subarray(a, b + 1);
      ContentRange = `bytes ${a}-${b}/${obj.bytes.length}`;
    }
    const Body = new PassThrough();
    Body.end(slice);
    return { Body, ContentLength: slice.length, ContentRange, ContentType: obj.type };
  }
  return { send, calls };
}

run('COACHIP media: R7 clip and R8 audio through the real router (Postgres, HTTP)', () => {
  let pg; let app; let s3; let cut; let store;

  const openClip = async (url, at, opts) => {
    cut.calls.push([url, at, opts]);
    if (cut.fail) throw new Error('clip timed out before any audio');
    const stream = new PassThrough();
    setImmediate(() => stream.end(Buffer.from('-cut')));
    return { stream, first: Buffer.from('ID3'), proc: { kill() {} } };
  };

  beforeAll(async () => {
    pg = await startPg();
    const q = pg.query;
    await ins.seedLibrary(q);
    for (const id of [CA, CB, RM, RM2]) await seed.user(q, { id, role: 'coach' });
    await seed.school(q, { id: S1, n: 1 });
    await seed.school(q, { id: S2, n: 2 });
    await seed.holds(q, { coachId: CA, schoolId: S1 });
    await seed.holds(q, { coachId: CB, schoolId: S2 });
    await seed.user(q, { id: T1, role: 'teacher', schoolId: S1 });
    await seed.user(q, { id: T2, role: 'teacher', schoolId: S2 });
    await seed.setting(q, 'portal_coachip', [CA, CB]);
    await seed.setting(q, 'portal_coachip_rm', { [RM]: 'Urban-I', [RM2]: 'Tarnol' });
    await q('INSERT INTO coaching_sessions (id, user_id, audio_url) VALUES ($1,$2,$3), ($4,$5,$6), ($7,$8,NULL)',
      [SESS1, T1, recUrl(T1, SESS1), SESS2, T1, recUrl(T1, SESS2), SESS3, T1]);
    const r = await ins.jobRun(q, { date: '2026-10-26' });
    const key = teacherKeyFor(seed.SECRET, T1);
    const f1 = await ins.fact(q, { sessionId: SESS1, teacherKey: key, schoolId: S1, date: '2026-10-21', jobRunId: r });
    const f2 = await ins.fact(q, { sessionId: SESS2, teacherKey: key, schoolId: S1, date: '2026-10-22', jobRunId: r });
    const f3 = await ins.fact(q, { sessionId: SESS3, teacherKey: key, schoolId: S1, date: '2026-10-23', jobRunId: r });
    await ins.moment(q, { id: MOM_READY, factId: f1, sessionId: SESS1, wId: 'W-IP-TIME', from: 1100, to: 1138, clip: 'ready' });
    await ins.moment(q, { id: MOM_PENDING, factId: f2, sessionId: SESS2, wId: 'W-IP-TIME', from: 600, to: 640, clip: 'pending' });
    await ins.moment(q, { id: MOM_NOAUDIO, factId: f3, sessionId: SESS3, wId: 'W-IP-TIME', from: 60, to: 100, clip: 'pending' });
    await q(`INSERT INTO coachip_circle_items (sector, week_start, coach_user_id, moment_id, job_run_id)
             VALUES ('Urban-I', '2026-10-26', $1, $2, $3)`, [CA, MOM_READY, r]);

    store = {
      [`${BUCKET}/${CLIP_KEY}`]: { bytes: FILLER(1000, 1), type: 'audio/mpeg' },
      [`${BUCKET}/${FULL_KEY}`]: { bytes: FILLER(3000, 2), type: 'audio/mpeg' },
      [`${BUCKET}/${recKey(T1, SESS2)}`]: { bytes: FILLER(2000, 3), type: 'application/octet-stream' },
    };
    s3 = fakeS3(store);
    cut = { calls: [], fail: false };
    // a real S3Client (the presigner signs with it) whose send is the fictional store: only the network is faked
    const client = new realS3.S3Client({ region: 'auto', endpoint: ENV.R2_ENDPOINT, credentials: { accessKeyId: ENV.R2_ACCESS_KEY_ID, secretAccessKey: ENV.R2_SECRET_ACCESS_KEY } });
    client.send = s3.send;
    const clip = createClipService({ s3: client, sdk: realS3, presigner: realGetSignedUrl, env: ENV, openClip });
    app = await startApp(pg, {
      now: NOW,
      mediaRoutes: (router, guards) => {
        // the wiring index.js does: the scope's two checks and the codec's audit, unbound, as plain functions
        const { createCoachipScope } = require('../../dashboard/services/coachip-scope.service');
        const { createCoachipCodes } = require('../../dashboard/services/coachip-codes.service');
        const codes = createCoachipCodes({ query: pg.query, secret: seed.SECRET });
        const scope = createCoachipScope({ query: pg.query, codes, now: () => NOW });
        createCoachipMediaRoutes({ query: pg.query, inScope: scope.inScope, circleAllows: scope.circleAllows, audit: codes.audit, clip })(router, guards);
      },
    });
  }, 180000);
  afterAll(async () => { if (app) await app.close(); if (pg) await pg.close(); });
  beforeEach(() => { s3.calls.length = 0; cut.calls.length = 0; cut.fail = false; });

  // A play's audit row is written once its bytes are on their way, so it can land just after the response ends: settle first.
  const audits = async (actor) => (await new Promise((r) => setTimeout(r, 150)), await pg.query(
    'SELECT action::text AS action, subject_id::text AS subject_id FROM coachip_audit_log WHERE actor_user_id = $1 ORDER BY created_at, id', [actor],
  )).rows;
  const audioHeaders = (h, type = 'audio/mpeg') => {
    expect(h['content-type']).toBe(type);
    expect(h['content-disposition']).toBe('inline');
    expect(h['cache-control']).toBe('private, no-store');
    expect(h['x-content-type-options']).toBe('nosniff');
  };
  const NOT_FOUND = '{"error":"not_found"}';

  describe('R7 GET /coachip/m/:momentId/clip', () => {
    it('coach A, in scope, no Range: 200, the stored clip from the clip bucket, one `clip` audit row', async () => {
      const before = (await audits(CA)).length;
      const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CA });
      expect(r.status).toBe(200);
      audioHeaders(r.headers);
      expect(r.headers['accept-ranges']).toBe('bytes');
      expect(r.headers['content-length']).toBe('1000');
      expect(s3.calls[0]).toMatchObject({ kind: 'GetObjectCommand', Bucket: BUCKET, Key: CLIP_KEY });
      expect(cut.calls).toEqual([]);
      const rows = await audits(CA);
      expect(rows.length).toBe(before + 1);
      expect(rows[rows.length - 1]).toEqual({ action: 'clip', subject_id: MOM_READY });
    });

    it('coach A, bytes=0-: 206 and one audit row; bytes=500-: 206 and none (a seek)', async () => {
      const before = (await audits(CA)).length;
      const a = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CA, headers: { range: 'bytes=0-' } });
      expect(a.status).toBe(206);
      expect(a.headers['content-range']).toBe('bytes 0-999/1000');
      expect((await audits(CA)).length).toBe(before + 1);
      const b = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CA, headers: { range: 'bytes=500-' } });
      expect(b.status).toBe(206);
      expect(b.headers['content-range']).toBe('bytes 500-999/1000');
      expect(b.headers['content-length']).toBe('500');
      expect((await audits(CA)).length).toBe(before + 1);
    });

    it('an unsatisfiable range: 416, empty, bytes */size', async () => {
      const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CA, headers: { range: 'bytes=5000-' } });
      expect(r.status).toBe(416);
      expect(r.text).toBe('');
      expect(r.headers['content-range']).toBe('bytes */1000');
    });

    it('coach B (another coach\'s moment) → a 404 byte-identical to an invented moment id', async () => {
      const other = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CB });
      const none = await app.call('GET', `${P}/m/${INVENTED}/clip`, { as: CB });
      expect(other.status).toBe(404);
      expect(none.status).toBe(404);
      expect(other.text).toBe(NOT_FOUND);
      expect(other.text).toBe(none.text);
      for (const h of ['content-type', 'content-length', 'cache-control']) expect(other.headers[h]).toBe(none.headers[h]);
      expect(s3.calls).toEqual([]);
      expect(await audits(CB)).toEqual([]);
    });

    it('a non-UUID → 400 {"error":"bad_request"}, nothing read', async () => {
      const r = await app.call('GET', `${P}/m/not-a-uuid/clip`, { as: CA });
      expect(r.status).toBe(400);
      expect(r.text).toBe('{"error":"bad_request"}');
      expect(s3.calls).toEqual([]);
    });

    it('signed out → the house 401', async () => {
      const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`);
      expect(r.status).toBe(401);
    });

    it('the switch off for coach A → the one 404', async () => {
      await seed.setting(pg.query, 'portal_coachip', [CB]);
      try {
        const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CA });
        expect(r.status).toBe(404);
        expect(r.text).toBe(NOT_FOUND);
      } finally {
        await seed.setting(pg.query, 'portal_coachip', [CA, CB]);
      }
    });

    it('the RM whose circle holds the moment this week: 200 and `circle_play`', async () => {
      const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: RM });
      expect(r.status).toBe(200);
      audioHeaders(r.headers);
      expect(await audits(RM)).toEqual([{ action: 'circle_play', subject_id: MOM_READY }]);
    });

    it('an RM whose circle does not hold it → the one 404, no audit', async () => {
      const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: RM2 });
      expect(r.status).toBe(404);
      expect(r.text).toBe(NOT_FOUND);
      expect(await audits(RM2)).toEqual([]);
    });

    it('not cut yet: the live cut of the recording (300 s signed URL, from_s, { to }), 200, Accept-Ranges: none', async () => {
      const r = await app.call('GET', `${P}/m/${MOM_PENDING}/clip`, { as: CA, headers: { range: 'bytes=0-' } });
      expect(r.status).toBe(200);
      expect(r.text).toBe('ID3-cut');
      audioHeaders(r.headers);
      expect(r.headers['accept-ranges']).toBe('none');
      expect(r.headers['content-length']).toBeUndefined();
      const [url, at, opts] = cut.calls[0];
      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
      expect(new URL(url).host).toBe(`${BUCKET}.${HOST}`);
      expect(decodeURIComponent(new URL(url).pathname)).toBe(`/${recKey(T1, SESS2)}`);
      expect(at).toBe(600);
      expect(opts).toEqual({ to: 640 });
    });

    it('the stored clip missing from R2: falls back to the live cut', async () => {
      const saved = store[`${BUCKET}/${CLIP_KEY}`];
      delete store[`${BUCKET}/${CLIP_KEY}`];
      try {
        const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CA });
        expect(r.status).toBe(200);
        expect(r.headers['accept-ranges']).toBe('none');
        expect(cut.calls[0][1]).toBe(1100);
        expect(cut.calls[0][2]).toEqual({ to: 1138 });
      } finally {
        store[`${BUCKET}/${CLIP_KEY}`] = saved;
      }
    });

    it('the cut fails → 503 {"error":"clip_unavailable"}; no recording at all → the same 503', async () => {
      cut.fail = true;
      const a = await app.call('GET', `${P}/m/${MOM_PENDING}/clip`, { as: CA });
      expect(a.status).toBe(503);
      expect(a.text).toBe('{"error":"clip_unavailable"}');
      expect(a.headers['cache-control']).toBe('private, no-store');
      cut.fail = false;
      const b = await app.call('GET', `${P}/m/${MOM_NOAUDIO}/clip`, { as: CA });
      expect(b.status).toBe(503);
      expect(b.text).toBe('{"error":"clip_unavailable"}');
      expect(cut.calls.length).toBe(1);
    });

    it('a 503 is not a play: no audit row', async () => {
      cut.fail = true;
      const before = (await audits(CA)).length;
      const r = await app.call('GET', `${P}/m/${MOM_PENDING}/clip`, { as: CA });
      expect(r.status).toBe(503);
      expect((await audits(CA)).length).toBe(before);
    });

    it('a throwing audit is logged and the play proceeds', async () => {
      await pg.query("ALTER TABLE coachip_audit_log ADD CONSTRAINT fixture_refuse CHECK (action <> 'clip') NOT VALID");
      const errs = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const r = await app.call('GET', `${P}/m/${MOM_READY}/clip`, { as: CA });
        expect(r.status).toBe(200);
        // the audit runs once the bytes are on their way (a 503 is not a play), so it can land after the response ends
        for (let i = 0; i < 50 && !errs.mock.calls.length; i += 1) await new Promise((res) => setTimeout(res, 20));
        expect(errs).toHaveBeenCalled();
      } finally {
        errs.mockRestore();
        await pg.query('ALTER TABLE coachip_audit_log DROP CONSTRAINT fixture_refuse');
      }
    });
  });

  describe('R8 GET /coachip/session/:sessionId/audio', () => {
    it('coach A: the whole-lesson MP3 under coachip/full/<env>/ first, audio/mpeg, `full_audio`', async () => {
      const r = await app.call('GET', `${P}/session/${SESS1}/audio`, { as: CA });
      expect(r.status).toBe(200);
      audioHeaders(r.headers);
      expect(r.headers['content-length']).toBe('3000');
      expect(s3.calls[0]).toMatchObject({ kind: 'GetObjectCommand', Bucket: BUCKET, Key: FULL_KEY });
      const rows = await audits(CA);
      expect(rows[rows.length - 1]).toEqual({ action: 'full_audio', subject_id: SESS1 });
    });

    it('no whole-lesson MP3: the recording itself, with its own type (webm → audio/webm), ranges honoured', async () => {
      const r = await app.call('GET', `${P}/session/${SESS2}/audio`, { as: CA, headers: { range: 'bytes=100-199' } });
      expect(r.status).toBe(206);
      audioHeaders(r.headers, 'audio/webm');
      expect(r.headers['content-range']).toBe('bytes 100-199/2000');
      expect(s3.calls.map((c) => c.Key)).toEqual([`coachip/full/sandbox/${SESS2}.mp3`, recKey(T1, SESS2)]);
      expect(s3.calls[1].Bucket).toBe(BUCKET);
      expect(JSON.stringify(r.headers)).not.toContain('classroom_audio');
      expect(JSON.stringify(r.headers)).not.toContain(T1);
    });

    it('the whole-lesson MP3 read fails (an R2 error, not "missing"): still the recording, not a 503', async () => {
      const fullKey2 = `${BUCKET}/coachip/full/sandbox/${SESS2}.mp3`;
      store[fullKey2] = { error: 'AccessDenied' };
      const errs = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const r = await app.call('GET', `${P}/session/${SESS2}/audio`, { as: CA });
        expect(r.status).toBe(200);
        audioHeaders(r.headers, 'audio/webm');
        expect(r.headers['content-length']).toBe('2000');
      } finally {
        delete store[fullKey2];
        errs.mockRestore();
      }
    });

    it('neither object → 503 {"error":"audio_unavailable"}; no recording → the same', async () => {
      const saved = store[`${BUCKET}/${recKey(T1, SESS2)}`];
      delete store[`${BUCKET}/${recKey(T1, SESS2)}`];
      try {
        const a = await app.call('GET', `${P}/session/${SESS2}/audio`, { as: CA });
        expect(a.status).toBe(503);
        expect(a.text).toBe('{"error":"audio_unavailable"}');
      } finally {
        store[`${BUCKET}/${recKey(T1, SESS2)}`] = saved;
      }
      const b = await app.call('GET', `${P}/session/${SESS3}/audio`, { as: CA });
      expect(b.status).toBe(503);
      expect(b.text).toBe('{"error":"audio_unavailable"}');
    });

    it('coach B → a 404 byte-identical to an invented session; non-UUID → 400', async () => {
      const other = await app.call('GET', `${P}/session/${SESS1}/audio`, { as: CB });
      const none = await app.call('GET', `${P}/session/${INVENTED}/audio`, { as: CB });
      expect(other.status).toBe(404);
      expect(other.text).toBe(NOT_FOUND);
      expect(other.text).toBe(none.text);
      expect(s3.calls).toEqual([]);
      const bad = await app.call('GET', `${P}/session/nope/audio`, { as: CA });
      expect(bad.status).toBe(400);
      expect(bad.text).toBe('{"error":"bad_request"}');
    });

    it('an RM (even the one whose circle holds a moment of this session) → 404 (A4: coach only)', async () => {
      const r = await app.call('GET', `${P}/session/${SESS1}/audio`, { as: RM });
      expect(r.status).toBe(404);
      expect(r.text).toBe(NOT_FOUND);
      expect(s3.calls).toEqual([]);
    });

    it('a seek writes no audit row', async () => {
      const before = (await audits(CA)).length;
      const r = await app.call('GET', `${P}/session/${SESS1}/audio`, { as: CA, headers: { range: 'bytes=500-' } });
      expect(r.status).toBe(206);
      expect((await audits(CA)).length).toBe(before);
    });
  });
});
