'use strict';
/**
 * bd-zrdvmi.60 (ICT sheet, Lesson Plan row 983) — with lp_whatsapp_pdf_off a teacher who taps ONE grades 1-5 plan in
 * the WhatsApp Flow got a link to the Lesson Plans home, not that plan. The `lp_open` landing opens the plan she
 * tapped (/portal/teacher/lessons/open?plan=k5:<lesson_id>). The plan key rides inside the encrypted token; a
 * malformed one is dropped and the page goes to Lesson Plans, as before.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const PLAN = 'k5:grade_1_english_ch4_seg2';
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://testref.supabase.co' };
});
afterAll(() => { process.env = ENV; });

const load = () => require('../../bot/shared/services/app-login-link');

describe('signer', () => {
  test('lp_open carries the plan key through the token', () => {
    const { signAppLink, verifyAppLink } = load();
    expect(verifyAppLink(signAppLink(USER, 'lp_open', null, { plan: PLAN }))).toEqual(expect.objectContaining({ f: 'lp_open', q: { plan: PLAN } }));
  });

  test('the plan key is not readable in the token', () => {
    const t = load().signAppLink(USER, 'lp_open', null, { plan: PLAN });
    expect(Buffer.from(t, 'base64url').toString('latin1')).not.toContain('grade_1_english');
  });

  test.each([
    [{ plan: 'g612:abc' }], [{ plan: 'k5:' }], [{ plan: 'k5:a b' }], [{ plan: 'k5:x?y=1' }], [{ plan: `k5:${'a'.repeat(200)}` }],
    [{ plan: 7 }], [{}], [null],
  ])('a malformed plan is dropped, the link still works: %j', (q) => {
    const { signAppLink, verifyAppLink } = load();
    expect(verifyAppLink(signAppLink(USER, 'lp_open', null, q))).toEqual(expect.objectContaining({ f: 'lp_open', q: null }));
  });

  test('lesson_plan itself never carries a plan', () => {
    const { signAppLink, verifyAppLink } = load();
    expect(verifyAppLink(signAppLink(USER, 'lesson_plan', null, { plan: PLAN })).q).toBeNull();
  });
});

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
async function app({ v2 = true } = {}) {
  const a = express();
  a.use((req, _res, next) => { req.session = { regenerate(cb) { cb(); }, save(cb) { cb(); } }; next(); });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === USER ? { id: USER, name: 'Ayesha' } : null),
    isTeacherV2: async () => v2,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const location = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { res.resume(); resolve(res.headers.location); }).on('error', reject);
});

describe('redeem', () => {
  test('lands on the plan she tapped', async () => {
    const to = await location(await app(), `/go/${load().signAppLink(USER, 'lp_open', null, { plan: PLAN })}`);
    const u = new URL(to, 'http://x');
    expect(u.pathname).toBe('/portal/teacher/lessons/open');
    expect(Object.fromEntries(u.searchParams)).toEqual({ plan: PLAN });
  });

  test('no plan: the open page, which goes on to Lesson Plans', async () => {
    expect(await location(await app(), `/go/${load().signAppLink(USER, 'lp_open')}`)).toBe('/portal/teacher/lessons/open');
  });

  test('off the teacher app: today\'s portal home', async () => {
    expect(await location(await app({ v2: false }), `/go/${load().signAppLink(USER, 'lp_open', null, { plan: PLAN })}`)).toBe('/portal/dashboard');
  });
});
