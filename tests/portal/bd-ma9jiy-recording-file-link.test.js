/**
 * bd-ma9jiy (queue #262; the operator 25 Nov ~19:50: "the button to save the recording ... on the component where there's
 * a seek bar") — GET /api/portal/recording-file/link?src=<the player's signed R2 link>&name=NIETE_OBS_3Eng_25Nov_1040.webm
 * answers { url, filename }: the SAME object signed again as an attachment under that name, so Chrome saves it, and
 * WhatsApp's browser hands it to Chrome (open-file.html) where it saves.
 *
 * Safety: it re-signs ONLY a link R2 itself accepts right now (a 1-byte ranged GET of `src` must answer 200/206), so a made-up
 * link to someone else's file gets nothing; a session is required; the name must be ours (NIETE_OBS_/NIETE_DBRF_…), else
 * the file's own name.
 */
const http = require('http');
const express = require('express');

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const SIGNED = 'https://acc.r2.cloudflarestorage.com/rumi-bucket/coach-observations/u1/obs-9.webm?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc&X-Amz-Date=20261125T150000Z&X-Amz-Expires=3600';

describe('GET /recording-file/link — Save to phone', () => {
  let emitted;
  let presign;
  let servers = [];
  let probeStatus;
  let probed;
  beforeEach(() => {
    jest.resetModules();
    emitted = [];
    probeStatus = 206;
    probed = [];
    presign = jest.fn(async (url, exp, opts) => `${url}?signed=attachment&name=${encodeURIComponent(opts.filename)}`);
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: presign,
      isValidR2Url: (u) => /r2\.cloudflarestorage\.com/.test(String(u)),
    }));
  });
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function app(session = { id: 's1', portalUserId: USER }) {
    const a = express();
    a.use((req, _res, next) => { req.session = session; next(); });
    const { createRecordingFileRouter } = require('../../dashboard/routes/recording-file.routes');
    a.use('/api/portal', createRecordingFileRouter({
      probe: async (url) => { probed.push(url); return probeStatus; },
    }));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const get = (srv, q) => new Promise((resolve, reject) => {
    const path = `/api/portal/recording-file/link?${new URLSearchParams(q).toString()}`;
    http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    }).on('error', reject);
  });

  test('a live signed link → the same file signed as an attachment under our name', async () => {
    const res = await get(await app(), { src: SIGNED, name: 'NIETE_OBS_3Eng_25Nov_1040.webm' });
    expect(res.status).toBe(200);
    expect(probed).toEqual([SIGNED]);
    expect(presign).toHaveBeenCalledWith(SIGNED.split('?')[0], 3600, { disposition: 'attachment', filename: 'NIETE_OBS_3Eng_25Nov_1040.webm' });
    expect(res.body).toEqual({ url: expect.stringContaining('signed=attachment'), filename: 'NIETE_OBS_3Eng_25Nov_1040.webm' });
    expect(emitted.find((x) => x.e === 'recording.save_link').d).toEqual(expect.objectContaining({ userId: USER, kind: 'obs' }));
  });

  test('a link R2 refuses (made up, or expired) → 403, nothing signed', async () => {
    probeStatus = 403;
    const res = await get(await app(), { src: SIGNED, name: 'NIETE_DBRF_25Nov_1040.webm' });
    expect(res.status).toBe(403);
    expect(presign).not.toHaveBeenCalled();
  });

  test('not our storage, not signed, no session → refused before any probe', async () => {
    const srv = await app();
    expect((await get(srv, { src: 'https://evil.example/x.webm?X-Amz-Signature=1', name: 'NIETE_OBS_x.webm' })).status).toBe(400);
    expect((await get(srv, { src: SIGNED.split('?')[0], name: 'NIETE_OBS_x.webm' })).status).toBe(400);
    expect((await get(await app({}), { src: SIGNED, name: 'NIETE_OBS_x.webm' })).status).toBe(401);
    expect(probed).toEqual([]);
  });

  test('a name that is not ours → the file\'s own name', async () => {
    const res = await get(await app(), { src: SIGNED, name: '../../etc/passwd' });
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe('obs-9.webm');
  });
});
