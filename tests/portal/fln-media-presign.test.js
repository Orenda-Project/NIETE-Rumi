'use strict';
/**
 * FLN media served as presigned URLs on the portal's OWN private R2 bucket (COS ruling 190012 item 2, red team 190210).
 *
 * The public mirror rate-limits (429s at 1.9% from one client), so GET /api/portal/fln/plan/:id must never hand a
 * mirror URL to the browser: every `fln/<kind>/<sha8>/<name>` key is re-addressed to the same key on R2_BUCKET_NAME,
 * signed with the date floored to 00:00Z (one URL per key per UTC day, so the browser cache hits on a reopen) and the
 * SigV4 maximum expiry of 7 days (a tab left open overnight still plays). Signing is matched by KEY, never by host.
 * A signing failure never costs the plan: `src` falls back to the S3 `orig`.
 *
 * Real: express, the route, fln-access, the corpus service and the media signer. The AWS SDK is the boundary: when the
 * portal's own copy is installed (dashboard/node_modules — a local run) the REAL client + presigner sign (local
 * crypto, no request leaves the process); the root CI job installs root deps only, so the root client stub and a
 * recording fake with the SigV4 query shape stand in. Every call is recorded either way. The SDK mocks are virtual and
 * the client is mocked by the file it resolves to, so the suite runs the same with or without tests/jest.config.js's
 * moduleNameMapper and with or without @aws-sdk at the repo root (no branch declares it there).
 * Mocked: supabase, the pg pool, telemetry, global fetch.
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { build } = require('./fixtures/fln-corpus.fixture');

const ENV = { ...process.env };
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const MIRROR = 'https://pub-0123456789abcdef0123456789abcdef.r2.dev';
const ENDPOINT_HOST = '0a1b2c3d4e5f.r2.cloudflarestorage.com';
const BUCKET = 'rumi-sandbox';
const S3 = 'https://lp-audios-bucket.s3.ap-south-1.amazonaws.com';
const IMG_S3 = 'https://lmsreborn-lp-images.s3.ap-south-1.amazonaws.com';
const VID_S3 = 'https://lp-videos-bucket.s3.ap-south-1.amazonaws.com';
const DAY1 = Date.UTC(2026, 9, 19, 7, 30, 0);
const DAY1_LATE = Date.UTC(2026, 9, 19, 23, 59, 0);
const DAY2 = Date.UTC(2026, 9, 20, 0, 1, 0);

let settings; let nowMs; let presignCalls;

/** The portal's real SDK when installed, else null (root CI). */
const REAL = (() => {
  try {
    const nm = path.join(__dirname, '..', '..', 'dashboard', 'node_modules', '@aws-sdk');
    require.resolve(path.join(nm, 's3-request-presigner'));
    return { s3: path.join(nm, 'client-s3'), presigner: path.join(nm, 's3-request-presigner') };
  } catch (_) {
    return null;
  }
})();

/** Root-CI stand-in: deterministic in (bucket, key, signingDate, expiresIn), shaped like a virtual-hosted SigV4 GET. */
async function fakePresign(client, command, opts) {
  const host = new URL(client.config.endpoint).host;
  const { Bucket, Key } = command.input;
  const amzDate = opts.signingDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const sig = crypto.createHash('sha256').update(`${Bucket}|${Key}|${amzDate}|${opts.expiresIn}`).digest('hex');
  return `https://${Bucket}.${host}/${Key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${amzDate}&X-Amz-Expires=${opts.expiresIn}&X-Amz-Signature=${sig}`;
}

function mockSdk() {
  presignCalls = [];
  const s3 = REAL ? REAL.s3 : path.join(__dirname, '..', '__mocks__', 'aws-sdk-client-s3');
  jest.doMock('@aws-sdk/client-s3', () => jest.requireActual(s3), { virtual: true });
  jest.doMock('@aws-sdk/s3-request-presigner', () => {
    const real = REAL ? jest.requireActual(REAL.presigner).getSignedUrl : null;
    return {
      getSignedUrl: async (client, command, opts) => {
        presignCalls.push({ bucket: command.input.Bucket, key: command.input.Key, opts });
        return real ? real(client, command, opts) : fakePresign(client, command, opts);
      },
    };
  }, { virtual: true });
}

function supabaseStub() {
  return {
    from(table) {
      const eqs = {};
      const q = {
        select: () => q,
        eq: (c, v) => { eqs[c] = v; return q; },
        maybeSingle: async () => {
          if (table === 'app_settings') return { data: eqs.key in settings ? { value: settings[eqs.key] } : null, error: null };
          if (table === 'users') return { data: { id: eqs.id, role: 'teacher', preferred_language: 'en' }, error: null };
          return { data: null, error: null };
        },
      };
      return q;
    },
  };
}

/** The fixture corpus, with plan 900003 carrying every media shape the real bundle has. */
function corpusWithMirror() {
  const c = build();
  const p = c.plans[900003];
  p.sections = [{
    kind: 'opening',
    minutes: 5,
    groups: [{
      header: null,
      level: null,
      items: [
        { kind: 'say', text: 'Say **a**.', media: [
          { kind: 'audio', role: 'sound', ok: true, label_en: 'a', src: `${MIRROR}/fln/audio/4fddc62f/file.mp3`, orig: `${S3}/59a71a8b_Alif.mp3` },
          { kind: 'image', ok: true, src: `${MIRROR}/fln/image-800/53b1e42a/img4.webp`, full: `${MIRROR}/fln/image/7d5224b3/img4.jpg`, orig: `${IMG_S3}/img4.jpg` },
          { kind: 'video', ok: true, src: `${MIRROR}/fln/video/f7156b8d/3bfcd217.mp4`, src_low: `${MIRROR}/fln/video/f7156b8d/3bfcd217-360p.mp4`, poster: `${MIRROR}/fln/poster/14ab882d/G1.jpg`, orig: `${VID_S3}/mp4/G1.mp4` },
          // not a mirror key: served exactly as it is
          { kind: 'audio', role: 'word', ok: true, label_en: 'b', src: `${S3}/only-s3_b.mp3`, orig: `${S3}/only-s3_b.mp3` },
        ] },
      ],
    }],
  }];
  // a generated narration: no S3 original, its `orig` is the mirror key too
  p.setup = [{ kind: 'say', text: 'Listen first.', media: [
    { kind: 'audio', role: 'narration', ok: true, src: `${MIRROR}/fln/narration/14e8b48e/14e8b48e_ur-11585.mp3`, orig: `${MIRROR}/fln/narration/14e8b48e/14e8b48e_ur-11585.mp3` },
  ] }];
  p.videos = [{ src: `${MIRROR}/fln/video/aa11bb22/v.mp4`, poster: `${MIRROR}/fln/poster/cc33dd44/v.jpg`, orig: `${VID_S3}/mp4/v.mp4` }];
  return c;
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  nowMs = DAY1;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  process.env = {
    ...ENV,
    FLN_CORPUS_BASE: 'https://cdn.example.test/fln/corpus',
    R2_ENDPOINT: `https://${ENDPOINT_HOST}`,
    R2_ACCESS_KEY_ID: 'flntestaccesskeyid',
    R2_SECRET_ACCESS_KEY: 'flntestsecret0000000000000000000000000000',
    R2_BUCKET_NAME: BUCKET,
  };
  settings = { portal_fln_lessons: true };
  global.fetch = jest.fn(async () => { throw new Error('no network in this test'); });
  jest.doMock('../../dashboard/config/supabase', () => supabaseStub());
  jest.doMock('../../dashboard/config/database', () => ({ query: async () => ({ rows: [] }) }));
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
  mockSdk();
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

const corpus = () => require('../../dashboard/services/fln-corpus.service');

async function app() {
  const c = corpusWithMirror();
  settings.fln_corpus_version = c.version;
  corpus().__setForTests(c);
  const a = express();
  a.use((req, _res, next) => { req.session = { id: 's1', portalUserId: TEACHER }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-fln.routes'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}

const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { data += c; });
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(data); } catch (_) { /* not json */ }
      resolve({ status: res.statusCode, headers: res.headers, json, text: data });
    });
  }).on('error', reject);
});

const media = (plan) => plan.sections[0].groups[0].items[0].media;
const narration = (plan) => plan.setup[0].media[0];

/** A presigned GET for exactly `key` on the portal bucket, signed at 00:00Z of `dayMs`, valid 7 days. */
function expectSigned(url, key, dayMs) {
  expect(typeof url).toBe('string');
  const u = new URL(url);
  expect(u.hostname.endsWith(ENDPOINT_HOST)).toBe(true);
  // virtual-hosted (bucket.host/key) or path style (host/bucket/key): the bucket and the SAME key either way
  const bucketInHost = u.hostname === `${BUCKET}.${ENDPOINT_HOST}`;
  expect(u.pathname).toBe(bucketInHost ? `/${key}` : `/${BUCKET}/${key}`);
  expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  expect(u.searchParams.get('X-Amz-Expires')).toBe('604800');
  const d = new Date(dayMs);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  expect(u.searchParams.get('X-Amz-Date')).toBe(`${ymd}T000000Z`);
}

describe('GET /fln/plan/:id serves the mirror keys presigned on the portal bucket', () => {
  it('no mirror host anywhere in the served JSON; every mirror URL is the same key, presigned; S3 orig untouched', async () => {
    const srv = await app();
    const r = await get(srv, '/api/portal/fln/plan/900003');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.text).not.toMatch(/r2\.dev/);
    const plan = r.json.plan;
    const [snd, img, vid, plain] = media(plan);
    expectSigned(snd.src, 'fln/audio/4fddc62f/file.mp3', DAY1);
    expect(snd.orig).toBe(`${S3}/59a71a8b_Alif.mp3`);
    expectSigned(img.src, 'fln/image-800/53b1e42a/img4.webp', DAY1);
    expectSigned(img.full, 'fln/image/7d5224b3/img4.jpg', DAY1);
    expect(img.orig).toBe(`${IMG_S3}/img4.jpg`);
    expectSigned(vid.src, 'fln/video/f7156b8d/3bfcd217.mp4', DAY1);
    expectSigned(vid.src_low, 'fln/video/f7156b8d/3bfcd217-360p.mp4', DAY1);
    expectSigned(vid.poster, 'fln/poster/14ab882d/G1.jpg', DAY1);
    expect(vid.orig).toBe(`${VID_S3}/mp4/G1.mp4`);
    expect(plain).toEqual({ kind: 'audio', role: 'word', ok: true, label_en: 'b', src: `${S3}/only-s3_b.mp3`, orig: `${S3}/only-s3_b.mp3` });
    expectSigned(narration(plan).src, 'fln/narration/14e8b48e/14e8b48e_ur-11585.mp3', DAY1);
    expect(narration(plan).orig).toBe(narration(plan).src);
    expectSigned(plan.videos[0].src, 'fln/video/aa11bb22/v.mp4', DAY1);
    expectSigned(plan.videos[0].poster, 'fln/poster/cc33dd44/v.jpg', DAY1);
    expect(plan.videos[0].orig).toBe(`${VID_S3}/mp4/v.mp4`);
  });

  it('two GETs on the same UTC day are byte-identical (cache hits on a reopen); the next day signs anew', async () => {
    const srv = await app();
    const a = await get(srv, '/api/portal/fln/plan/900003');
    nowMs = DAY1_LATE;
    const b = await get(srv, '/api/portal/fln/plan/900003');
    expect(b.text).toBe(a.text);
    nowMs = DAY2;
    const c = await get(srv, '/api/portal/fln/plan/900003');
    expect(media(c.json.plan)[0].src).not.toBe(media(a.json.plan)[0].src);
    expectSigned(media(c.json.plan)[0].src, 'fln/audio/4fddc62f/file.mp3', DAY2);
  });

  it('a fresh process signs the same URL on the same day (deterministic across cluster workers)', async () => {
    const srv1 = await app();
    const a = await get(srv1, '/api/portal/fln/plan/900003');
    jest.resetModules();
    jest.doMock('../../dashboard/config/supabase', () => supabaseStub());
    jest.doMock('../../dashboard/config/database', () => ({ query: async () => ({ rows: [] }) }));
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
    mockSdk();
    const srv2 = await app();
    const b = await get(srv2, '/api/portal/fln/plan/900003');
    expect(b.text).toBe(a.text);
  });

  it('signs each key once per day, not once per GET (memoised)', async () => {
    const Sign = require('../../dashboard/services/fln-media-sign');
    const srv = await app();
    await get(srv, '/api/portal/fln/plan/900003');
    const first = Sign.__statsForTests().signed;
    expect(first).toBe(9); // distinct mirror keys in plan 900003
    await get(srv, '/api/portal/fln/plan/900003');
    expect(Sign.__statsForTests().signed).toBe(first);
    nowMs = DAY2;
    await get(srv, '/api/portal/fln/plan/900003');
    expect(Sign.__statsForTests().signed).toBe(first * 2);
  });

  it('asks the SDK for the portal bucket, the SAME key, signingDate = 00:00Z of today, expiresIn = 604800', async () => {
    const srv = await app();
    await get(srv, '/api/portal/fln/plan/900003');
    expect(presignCalls).toHaveLength(9);
    const call = presignCalls.find((c) => c.key === 'fln/audio/4fddc62f/file.mp3');
    expect(call.bucket).toBe(BUCKET);
    expect(call.opts.expiresIn).toBe(604800);
    expect(call.opts.signingDate.toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  (REAL ? it : it.skip)('the REAL AWS SDK accepts the floored date + 7-day expiry and signs a SigV4 GET (local run)', async () => {
    const srv = await app();
    const r = await get(srv, '/api/portal/fln/plan/900003');
    const u = new URL(media(r.json.plan)[0].src);
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Credential')).toMatch(/^flntestaccesskeyid\/20261019\/auto\/s3\/aws4_request$/);
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('never mutates the cached corpus plan', async () => {
    const srv = await app();
    const before = JSON.stringify(corpus().plan('900003'));
    await get(srv, '/api/portal/fln/plan/900003');
    expect(JSON.stringify(corpus().plan('900003'))).toBe(before);
    expect(before).toMatch(/r2\.dev/);
  });
});

describe('fails closed: the plan is always served, src falls back to the S3 orig', () => {
  const expectFallback = (r) => {
    expect(r.status).toBe(200);
    const [snd, img, vid, plain] = media(r.json.plan);
    expect(snd.src).toBe(`${S3}/59a71a8b_Alif.mp3`);
    expect(img.src).toBe(`${IMG_S3}/img4.jpg`);
    expect(vid.src).toBe(`${VID_S3}/mp4/G1.mp4`);
    expect(plain.src).toBe(`${S3}/only-s3_b.mp3`);
    expect(r.json.plan.videos[0].src).toBe(`${VID_S3}/mp4/v.mp4`);
    // no S3 original: the narration keeps what it had
    expect(narration(r.json.plan).src).toBe(`${MIRROR}/fln/narration/14e8b48e/14e8b48e_ur-11585.mp3`);
    expect(JSON.stringify(r.json)).not.toMatch(/X-Amz-Signature/);
  };

  it('R2_BUCKET_NAME missing', async () => {
    delete process.env.R2_BUCKET_NAME;
    const srv = await app();
    expectFallback(await get(srv, '/api/portal/fln/plan/900003'));
  });

  it('credentials missing (endpoint/key/secret)', async () => {
    delete process.env.R2_SECRET_ACCESS_KEY;
    const srv = await app();
    expectFallback(await get(srv, '/api/portal/fln/plan/900003'));
  });

  it('the presigner itself throws', async () => {
    const Sign = require('../../dashboard/services/fln-media-sign');
    Sign.__setPresignForTests(async () => { throw new Error('boom'); });
    const srv = await app();
    expectFallback(await get(srv, '/api/portal/fln/plan/900003'));
  });

  it('logs once per reason, with no URL or key in the line', async () => {
    delete process.env.R2_BUCKET_NAME;
    const srv = await app();
    await get(srv, '/api/portal/fln/plan/900003');
    await get(srv, '/api/portal/fln/plan/900003');
    const lines = console.error.mock.calls.filter((c) => /FLN media/.test(String(c[0])));
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toMatch(/https?:|fln\/[a-z]/);
  });
});
