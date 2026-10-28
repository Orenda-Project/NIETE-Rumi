'use strict';
/**
 * bd-9dbhh0.1 (VIDREC), COS ruling 20261028T151950 §1.3, red7 152411 gate 3: the teacher's say lives on the clip page.
 *   GET  /v/:token     offers "Not now" + "Stop clips" (or "Turn clips back on" when stopped) as plain form posts.
 *   POST /v/:token/c   action=skip|stop|resume → clip-pref.apply with the TOKEN's ids only (never a body id); a one-line
 *                      confirmation in the teacher's language; bad → 404, expired → sign-in; a crawler writes nothing;
 *                      an unknown action → 400; a failed save says so (503) and changes nothing.
 * Real Express over HTTP (the harness of video-reco-routes.test.js); the loader and the preference writer are injected.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const REC = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '70530046-7ac3-4ea3-a976-b43c37c23299';
const SESSION = '1a2b3c4d-1111-4222-8333-444455556666';
const ROW = { id: REC, user_id: USER, coaching_session_id: SESSION, status: 'shown', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229, reason_en: 'Because.', reason_ur: 'اس لیے۔' };
const clipFor = (language = 'en', stopped = false) => ({
  row: ROW, module: { module_id: 63, title: 'Questioning', video_url: 'https://acc.r2.cloudflarestorage.com/b/v/63.mp4' },
  segment: { seg_id: '63-s2', title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال', start_s: 95, end_s: 229 }, language, stopped,
});

let emitted; let applied; let servers = [];
beforeEach(() => {
  jest.resetModules();
  emitted = []; applied = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk' };
});
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

async function app({ language = 'en', stopped = false, applyResult } = {}) {
  const a = express();
  a.use(require('../../dashboard/routes/video-reco.routes').createVideoRecoRouter({
    loadClip: async (r, u) => (r === REC && u === USER ? clipFor(language, stopped) : null),
    presign: async (url) => `${url}?sig`,
    insertEvent: async () => ({ error: null }),
    applyChoice: async (userId, action, o) => {
      applied.push({ userId, action, ...o });
      if (applyResult) return applyResult;
      return { ok: true, stopped: action === 'stop' ? true : action === 'resume' ? false : stopped, changed: true };
    },
  }));
  a.use((_q, res) => res.status(418).send('fell through'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}

function req(srv, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, headers }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}
const sign = (ids = { recommendationId: REC, userId: USER }) => require('../../bot/shared/services/coaching/video-reco/link-token').signVideoLink({ ...ids, surface: 'wa' });
const IAB = 'Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 Chrome/118 Mobile Safari/537.36 WhatsApp/2.24';
const form = (action, extra = '') => ({ headers: { 'user-agent': IAB, 'content-type': 'application/x-www-form-urlencoded' }, body: `action=${action}${extra}` });

describe('GET /v/:token offers the choice', () => {
  test('not stopped: "Not now" and "Stop clips", posting to /v/<token>/c', async () => {
    const t = sign();
    const res = await req(await app(), 'GET', `/v/${t}`, { headers: { 'user-agent': IAB } });
    expect(res.status).toBe(200);
    expect(res.body).toContain(`<form class="choice" method="post" action="/v/${t}/c">`);
    expect(res.body).toContain('value="skip">Not now</button>');
    expect(res.body).toContain('value="stop">Stop clips</button>');
    expect(res.body).not.toContain('value="resume"');
  });
  test('stopped: only "Turn clips back on"; Urdu page in Urdu', async () => {
    const res = await req(await app({ language: 'ur', stopped: true }), 'GET', `/v/${sign()}`, { headers: { 'user-agent': IAB } });
    expect(res.body).toContain('value="resume" class="on">کلپ دوبارہ چالو کریں</button>');
    expect(res.body).toContain('آپ کی رپورٹوں کے لیے کلپ بند ہیں۔');
    expect(res.body).not.toContain('value="stop"');
  });
});

describe('POST /v/:token/c', () => {
  test.each([
    ['skip', 'Okay, not now.'],
    ['stop', 'Clips are off.'],
    ['resume', 'Clips are back on.'],
  ])('%s → the token\'s teacher and clip, a one-line confirmation, the report and the clip one tap away', async (action, line) => {
    const t = sign();
    const res = await req(await app(), 'POST', `/v/${t}/c`, form(action));
    expect(res.status).toBe(200);
    expect(applied).toEqual([{ userId: USER, action, recommendationId: REC }]);
    expect(res.body).toContain(line);
    expect(res.body).toContain(`href="/v/${t}"`);
    expect(res.body).toMatch(/href="\/cr\/[^"]+"/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(emitted.find((x) => x.e === 'video_reco.choice').d).toMatchObject({ action, ok: true, recommendationId: REC, surface: 'wa', ua_class: 'in_app' });
  });

  test('stop → the confirmation carries the way back on, one tap', async () => {
    const t = sign();
    const res = await req(await app(), 'POST', `/v/${t}/c`, form('stop'));
    expect(res.body).toContain(`<form class="choice" method="post" action="/v/${t}/c"><button type="submit" name="action" value="resume" class="on">Turn clips back on</button></form>`);
  });

  test('Urdu teacher → Urdu confirmation, gender-neutral (no سکتے/سکتی، no کریں گے/گی)', async () => {
    const res = await req(await app({ language: 'ur' }), 'POST', `/v/${sign()}/c`, form('stop'));
    expect(res.body).toContain('کلپ بند ہو گئے ہیں۔');
    expect(res.body).toMatch(/<html lang="ur" dir="rtl">/);
    expect(res.body).not.toMatch(/سکتے ہیں|سکتی ہیں|کریں گے|کریں گی/);
  });

  test('a body id is ignored: only the token\'s teacher is ever changed', async () => {
    await req(await app(), 'POST', `/v/${sign()}/c`, form('stop', `&userId=${OTHER}&recommendationId=${OTHER}`));
    expect(applied).toEqual([{ userId: USER, action: 'stop', recommendationId: REC }]);
  });

  test('bad token → 404, nothing applied; expired → sign-in, nothing applied', async () => {
    const srv = await app();
    const bad = await req(srv, 'POST', `/v/${sign()}x/c`, form('stop'));
    expect(bad.status).toBe(404);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 200 * 86400 * 1000);
    const old = sign();
    Date.now.mockRestore();
    const exp = await req(srv, 'POST', `/v/${old}/c`, form('stop'));
    expect(exp.status).toBe(302);
    expect(exp.headers.location).toBe('/portal/login');
    expect(applied).toEqual([]);
  });

  test('unknown action → 400; a crawler → 204; neither writes', async () => {
    const srv = await app();
    expect((await req(srv, 'POST', `/v/${sign()}/c`, form('delete'))).status).toBe(400);
    const crawl = await req(srv, 'POST', `/v/${sign()}/c`, { headers: { 'user-agent': 'facebookexternalhit/1.1', 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=stop' });
    expect(crawl.status).toBe(204);
    expect(applied).toEqual([]);
  });

  test('a token for a clip that is not this teacher\'s (or gone) → 404, nothing applied', async () => {
    const res = await req(await app(), 'POST', `/v/${sign({ recommendationId: REC, userId: OTHER })}/c`, form('stop'));
    expect(res.status).toBe(404);
    expect(applied).toEqual([]);
  });

  test('a failed save → 503 and the page says it did not save; stopped state as it was', async () => {
    const res = await req(await app({ applyResult: { ok: false, stopped: null, changed: false } }), 'POST', `/v/${sign()}/c`, form('stop'));
    expect(res.status).toBe(503);
    expect(res.body).toContain('Sorry, that did not save.');
    expect(res.body).not.toContain('value="resume"');
  });
});
