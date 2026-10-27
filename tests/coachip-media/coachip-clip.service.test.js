'use strict';
/**
 * bd-sex15q.16 (m-player, server) — the COACHIP clip service (contracts/API.md §10 R7/R8, "Never"; SPEC v2 §7):
 *
 *   presign(location)        the REAL presigner signs a 300 s GetObject (never the house 3600 s default)
 *   streamObject(req, res)   200 whole / 206 one range / 416 with the size; a malformed or multi Range is the whole object;
 *                            audio headers exactly; the R2 body is destroyed when the listener goes away
 *   liveCut(req, res)        the presigned recording into openClip with { to } only (its own 20 s first-byte budget);
 *                            200, Accept-Ranges: none, no Content-Length, Range ignored; a rejection writes nothing
 *   logging                  at most the error's name: never a key, a URL, a bucket host or an X-Amz string
 *
 * Only the network boundary is faked (the S3 send, openClip); the service is the real one, served by a real express app.
 * Fictional ids and keys only; no audio, a few bytes of filler stand in for it.
 */
const http = require('http');
const path = require('path');
const { PassThrough, Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..', '..');
const express = require(path.join(ROOT, 'dashboard', 'node_modules', 'express'));
// The root jest config maps the two AWS packages to stubs; the real ones live in dashboard/node_modules.
const realS3 = require(path.join(ROOT, 'dashboard', 'node_modules', '@aws-sdk', 'client-s3'));
const { getSignedUrl: realGetSignedUrl } = require(path.join(ROOT, 'dashboard', 'node_modules', '@aws-sdk', 's3-request-presigner'));
const { createClipService, PRESIGN_TTL_S } = require('../../dashboard/services/coachip-clip.service');

const TEACHER = '00000000-0000-4000-8000-0b0000000001';   // fictional users.id inside a fictional key
const SESSION = '00000000-0000-4000-8000-030000000001';
const HOST = 'fictional-account.r2.cloudflarestorage.com';
const BUCKET = 'fictional-bucket';
const REC_KEY = `classroom_audio/${TEACHER}/2026-10/portal_${SESSION}.webm`;
const AUDIO_URL = `https://${HOST}/${BUCKET}/${REC_KEY}`;
const CLIP_KEY = `coachip/clips/sandbox/${SESSION}/1100-1138.mp3`;
const ENV = {
  R2_ENDPOINT: `https://${HOST}`, R2_ACCESS_KEY_ID: 'FICTIONALKEYID0000', R2_SECRET_ACCESS_KEY: 'fictional-secret-0000000000000000000000',
  R2_BUCKET_NAME: BUCKET, COACHIP_ENV: 'sandbox',
};
const BYTES = Buffer.from('0123456789'.repeat(20));   // 200 bytes of filler, not audio

/** A fake S3 send over one object store: GetObject with R2's own Range answers, HeadObject. Records every call. */
function fakeS3(store = { [`${BUCKET}/${CLIP_KEY}`]: BYTES }, over = {}) {
  const calls = [];
  const bodies = [];
  const err = (name, status, message = name) => Object.assign(new Error(message), { name, Code: name, $metadata: { httpStatusCode: status } });
  async function send(cmd) {
    const kind = cmd.constructor.name;
    const input = cmd.input;
    calls.push({ kind, input });
    if (over.send) return over.send(cmd);
    const obj = store[`${input.Bucket}/${input.Key}`];
    if (!obj) throw err('NoSuchKey', 404);
    if (kind === 'HeadObjectCommand') return { ContentLength: obj.length, ContentType: 'audio/mpeg' };
    let slice = obj;
    let contentRange;
    if (input.Range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(input.Range);
      let a = m[1] === '' ? obj.length - Number(m[2]) : Number(m[1]);
      let b = m[1] === '' || m[2] === '' ? obj.length - 1 : Math.min(Number(m[2]), obj.length - 1);
      if (a >= obj.length || a > b) throw err('InvalidRange', 416);
      a = Math.max(0, a);
      slice = obj.subarray(a, b + 1);
      contentRange = `bytes ${a}-${b}/${obj.length}`;
    }
    const body = over.body ? over.body() : Readable.from([slice]);
    bodies.push(body);
    return { Body: body, ContentLength: slice.length, ContentRange: contentRange, ContentType: over.contentType || 'audio/mpeg' };
  }
  return { send, calls, bodies };
}

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; jest.restoreAllMocks(); });

/** One express app whose single route runs fn(service, req, res) and answers 599 when the service did not write. */
async function serve(service, fn) {
  const a = express();
  const results = [];
  a.get('/x', async (req, res) => {
    const r = await fn(service, req, res);
    results.push(r);
    if (r !== 'served' && !res.headersSent) res.status(599).json({ result: r });
  });
  const srv = await new Promise((r) => { const s = a.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(srv);
  return { srv, results };
}
function get(srv, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: '/x', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
const AUDIO_HEADERS = (h, type = 'audio/mpeg') => {
  expect(h['content-type']).toBe(type);
  expect(h['content-disposition']).toBe('inline');
  expect(h['cache-control']).toBe('private, no-store');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(JSON.stringify(h)).not.toMatch(/filename/i);
};

describe('presign: the real presigner, 300 seconds', () => {
  it('PRESIGN_TTL_S is 300 and the signed URL says X-Amz-Expires=300', async () => {
    expect(PRESIGN_TTL_S).toBe(300);
    const svc = createClipService({ sdk: realS3, presigner: realGetSignedUrl, env: ENV });
    const url = await svc.presign({ bucket: BUCKET, key: REC_KEY });
    const u = new URL(url);
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
    // the house client's style: virtual-hosted, <bucket>.<account host> (r2.service.js builds the same S3Client)
    expect(u.host).toBe(`${BUCKET}.${HOST}`);
    expect(decodeURIComponent(u.pathname)).toBe(`/${REC_KEY}`);
  });

  it('recordingLocation reads <host>/<bucket>/<key>; anything not an R2 URL is null', () => {
    const svc = createClipService({ env: ENV, s3: fakeS3() });
    expect(svc.recordingLocation(AUDIO_URL)).toEqual({ bucket: BUCKET, key: REC_KEY });
    expect(svc.recordingLocation(null)).toBeNull();
    expect(svc.recordingLocation('/local/recording.webm')).toBeNull();
    expect(svc.recordingLocation('https://example.org/fictional-bucket/a.webm')).toBeNull();
    expect(svc.recordingLocation(`https://${HOST}/${BUCKET}`)).toBeNull();
  });

  it('clipBucket is COACHIP_CLIP_BUCKET, else R2_BUCKET_NAME', () => {
    expect(createClipService({ env: ENV }).clipBucket()).toBe(BUCKET);
    expect(createClipService({ env: { ...ENV, COACHIP_CLIP_BUCKET: 'fictional-clips' } }).clipBucket()).toBe('fictional-clips');
  });

  it('requiring the module and building a service constructs no S3 client (lazy)', () => {
    const S3Client = jest.fn();
    createClipService({ sdk: { ...realS3, S3Client }, env: ENV });
    expect(S3Client).not.toHaveBeenCalled();
  });
});

describe('streamObject: Range passed through, R2 answers mapped', () => {
  const stream = (s3) => serve(createClipService({ s3, env: ENV }), (svc, req, res) => svc.streamObject(req, res, { bucket: BUCKET, key: CLIP_KEY, contentType: 'audio/mpeg' }));

  it('no Range: 200, the whole object, Content-Length, Accept-Ranges: bytes, the audio headers', async () => {
    const s3 = fakeS3();
    const { srv, results } = await stream(s3);
    const r = await get(srv);
    expect(r.status).toBe(200);
    expect(r.body.equals(BYTES)).toBe(true);
    expect(r.headers['content-length']).toBe(String(BYTES.length));
    expect(r.headers['accept-ranges']).toBe('bytes');
    expect(r.headers['content-range']).toBeUndefined();
    AUDIO_HEADERS(r.headers);
    expect(s3.calls[0].input).toEqual({ Bucket: BUCKET, Key: CLIP_KEY });
    expect(results).toEqual(['served']);
  });

  it('bytes=0-99: 206 with GetObject\'s Content-Range, Content-Length 100', async () => {
    const s3 = fakeS3();
    const { srv } = await stream(s3);
    const r = await get(srv, { Range: 'bytes=0-99' });
    expect(r.status).toBe(206);
    expect(r.headers['content-range']).toBe(`bytes 0-99/${BYTES.length}`);
    expect(r.headers['content-length']).toBe('100');
    expect(r.headers['accept-ranges']).toBe('bytes');
    expect(r.body.equals(BYTES.subarray(0, 100))).toBe(true);
    AUDIO_HEADERS(r.headers);
    expect(s3.calls[0].input.Range).toBe('bytes=0-99');
  });

  it('an unsatisfiable range: 416, empty body, Content-Range bytes */<size> from HeadObject', async () => {
    const s3 = fakeS3();
    const { srv } = await stream(s3);
    const r = await get(srv, { Range: 'bytes=5000-' });
    expect(r.status).toBe(416);
    expect(r.body.length).toBe(0);
    expect(r.headers['content-range']).toBe(`bytes */${BYTES.length}`);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(s3.calls.map((c) => c.kind)).toEqual(['GetObjectCommand', 'HeadObjectCommand']);
  });

  it.each(['bytes=0-9,20-29', 'bytes=abc', 'items=0-9', 'bytes 0-9'])('Range %p is ignored: 200 and the whole object', async (range) => {
    const s3 = fakeS3();
    const { srv } = await stream(s3);
    const r = await get(srv, { Range: range });
    expect(r.status).toBe(200);
    expect(r.body.equals(BYTES)).toBe(true);
    expect(s3.calls[0].input.Range).toBeUndefined();
  });

  it('a missing object resolves "missing" and writes nothing', async () => {
    const s3 = fakeS3({});
    const { srv, results } = await stream(s3);
    const r = await get(srv);
    expect(r.status).toBe(599);
    expect(results).toEqual(['missing']);
  });

  it('another R2 error resolves "failed" and writes nothing', async () => {
    const s3 = fakeS3(undefined, { send: async () => { throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); } });
    const { srv, results } = await stream(s3);
    const r = await get(srv);
    expect(r.status).toBe(599);
    expect(results).toEqual(['failed']);
  });

  it('the listener going away destroys the R2 body', async () => {
    const body = new PassThrough();
    body.write(Buffer.from('filler'));   // first bytes go out, the rest never comes
    const s3 = fakeS3(undefined, { body: () => body });
    const { srv } = await stream(s3);
    await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: srv.address().port, path: '/x' }, (res) => {
        res.once('data', () => req.destroy());
      });
      req.on('error', () => {});
      req.on('close', resolve);
      setTimeout(() => reject(new Error('no response')), 5000);
    });
    for (let i = 0; i < 50 && !body.destroyed; i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(body.destroyed).toBe(true);
  });
});

describe('liveCut: the presigned recording through openClip', () => {
  function fakeOpenClip(over = {}) {
    const calls = [];
    const procs = [];
    const fn = async (url, at, opts) => {
      calls.push([url, at, opts]);
      if (over.reject) throw over.reject;
      const stream = new PassThrough();
      const proc = { killed: false, kill() { this.killed = true; } };
      procs.push(proc);
      if (!over.hang) setImmediate(() => stream.end(Buffer.from('-rest')));
      return { stream, first: Buffer.from('ID3'), proc };
    };
    return { fn, calls, procs };
  }
  const cut = (oc, deps = {}) => serve(
    createClipService({ sdk: realS3, presigner: realGetSignedUrl, env: ENV, openClip: oc.fn, ...deps }),
    (svc, req, res) => svc.liveCut(req, res, { audioUrl: AUDIO_URL, fromS: 1100, toS: 1138 }),
  );

  it('openClip gets a 300 s signed URL of the recording, from_s, and { to } only (its own 20 s first-byte budget)', async () => {
    const oc = fakeOpenClip();
    const { srv, results } = await cut(oc);
    const r = await get(srv, { Range: 'bytes=0-99' });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe('ID3-rest');
    expect(r.headers['accept-ranges']).toBe('none');
    expect(r.headers['content-length']).toBeUndefined();
    expect(r.headers['content-range']).toBeUndefined();
    AUDIO_HEADERS(r.headers);
    expect(results).toEqual(['served']);
    const [url, at, opts] = oc.calls[0];
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
    expect(new URL(url).host).toBe(`${BUCKET}.${HOST}`);
    expect(decodeURIComponent(new URL(url).pathname)).toBe(`/${REC_KEY}`);
    expect(at).toBe(1100);
    expect(opts).toEqual({ to: 1138 });   // no firstByteMs: neither shorter nor longer than openClip's default
  });

  it('a rejected cut (no first byte in time, ffmpeg gone) resolves "failed" and writes nothing', async () => {
    const oc = fakeOpenClip({ reject: new Error('clip timed out before any audio') });
    const { srv, results } = await cut(oc);
    const r = await get(srv);
    expect(r.status).toBe(599);
    expect(results).toEqual(['failed']);
  });

  it('a recording URL that is not R2 is "failed" and ffmpeg never starts', async () => {
    const oc = fakeOpenClip();
    const svc = createClipService({ sdk: realS3, presigner: realGetSignedUrl, env: ENV, openClip: oc.fn });
    const { srv, results } = await serve(svc, (s, req, res) => s.liveCut(req, res, { audioUrl: '/tmp/x.webm', fromS: 1, toS: 2 }));
    expect((await get(srv)).status).toBe(599);
    expect(results).toEqual(['failed']);
    expect(oc.calls).toEqual([]);
  });

  it('the listener going away kills ffmpeg', async () => {
    const oc = fakeOpenClip({ hang: true });
    const { srv } = await cut(oc);
    await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: srv.address().port, path: '/x' }, (res) => { res.once('data', () => req.destroy()); });
      req.on('error', () => {});
      req.on('close', resolve);
    });
    for (let i = 0; i < 50 && !(oc.procs[0] && oc.procs[0].killed); i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(oc.procs[0].killed).toBe(true);
  });
});

describe('logging: never a key, a URL, a bucket host or a signature', () => {
  const FORBIDDEN = [REC_KEY, CLIP_KEY, TEACHER, 'classroom_audio', 'r2.cloudflarestorage', 'X-Amz', 'https://', BUCKET];
  function spyAll() {
    const lines = [];
    for (const m of ['log', 'warn', 'error', 'info', 'debug']) {
      jest.spyOn(console, m).mockImplementation((...a) => { lines.push(a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : String(x))).join(' ')); });
    }
    return lines;
  }
  const loud = (name) => Object.assign(
    new Error(`${name}: ${AUDIO_URL}?X-Amz-Signature=abc key=${REC_KEY} ${CLIP_KEY}`),
    { name, $metadata: { httpStatusCode: 500 } },
  );

  it('a failing GetObject, a failing HeadObject, a failing presign and a failing cut log nothing that names the object', async () => {
    const lines = spyAll();
    // 1. GetObject fails
    let svc = createClipService({ env: ENV, s3: fakeS3(undefined, { send: async () => { throw loud('InternalError'); } }) });
    let app = await serve(svc, (s, req, res) => s.streamObject(req, res, { bucket: BUCKET, key: CLIP_KEY, contentType: 'audio/mpeg' }));
    await get(app.srv);
    // 2. InvalidRange, then HeadObject fails
    let n = 0;
    svc = createClipService({
      env: ENV,
      s3: fakeS3(undefined, { send: async () => { n += 1; if (n === 1) throw Object.assign(loud('InvalidRange'), { $metadata: { httpStatusCode: 416 } }); throw loud('InternalError'); } }),
    });
    app = await serve(svc, (s, req, res) => s.streamObject(req, res, { bucket: BUCKET, key: CLIP_KEY, contentType: 'audio/mpeg' }));
    await get(app.srv, { Range: 'bytes=9999-' });
    // 3. the presign fails
    svc = createClipService({ env: ENV, presigner: async () => { throw loud('CredentialsProviderError'); }, openClip: async () => { throw new Error('unreachable'); } });
    app = await serve(svc, (s, req, res) => s.liveCut(req, res, { audioUrl: AUDIO_URL, fromS: 1, toS: 2 }));
    await get(app.srv);
    // 4. the cut fails with ffmpeg's message carrying the signed URL
    svc = createClipService({ sdk: realS3, presigner: realGetSignedUrl, env: ENV, openClip: async (url) => { throw new Error(`ffmpeg: ${url}: Server returned 403 for ${REC_KEY}`); } });
    app = await serve(svc, (s, req, res) => s.liveCut(req, res, { audioUrl: AUDIO_URL, fromS: 1, toS: 2 }));
    await get(app.srv);
    expect(lines.length).toBeGreaterThan(0);   // the failures are logged, by name
    for (const line of lines) for (const bad of FORBIDDEN) expect(line).not.toContain(bad);
  });
});
