'use strict';
/**
 * bd-pw1ccr.2 — the A/B report button: one tap opens the paper generator with grade, subject and chapter already
 * filled in, and the paper it makes is tagged origin=report (bd-pw1ccr.1). The pre-fill rides INSIDE the encrypted
 * token, for the assessment_report feature only; the redeem route turns it into the landing's query.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://testref.supabase.co' };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date('2026-10-10T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

const load = () => require('../../bot/shared/services/app-login-link');
const Q = { grade: 3, subject: 'english', chapter: 4 };

describe('signer', () => {
  test('assessment_report carries the pre-fill through the token', () => {
    const { signAppLink, verifyAppLink } = load();
    const p = verifyAppLink(signAppLink(USER, 'assessment_report', null, Q));
    expect(p).toEqual(expect.objectContaining({ f: 'assessment_report', q: Q }));
  });

  test('the pre-fill is not readable in the token', () => {
    const t = load().signAppLink(USER, 'assessment_report', null, { ...Q, subject: 'mathematics' });
    expect(Buffer.from(t, 'base64url').toString('latin1')).not.toContain('mathematics');
  });

  test('assessment_report without a pre-fill is still a link, q null', () => {
    const { signAppLink, verifyAppLink } = load();
    expect(verifyAppLink(signAppLink(USER, 'assessment_report')).q).toBeNull();
  });

  test('any other feature never carries a pre-fill', () => {
    const { signAppLink, verifyAppLink } = load();
    expect(verifyAppLink(signAppLink(USER, 'assessment_generator', null, Q)).q).toBeNull();
  });

  test.each([
    [{ ...Q, grade: 0 }], [{ ...Q, grade: 13 }], [{ ...Q, grade: '3' }], [{ ...Q, chapter: 0 }], [{ ...Q, chapter: 1.5 }],
    [{ ...Q, subject: 'Eng lish' }], [{ ...Q, subject: '' }], [{ grade: 3, subject: 'english' }], ['3-english-4'],
  ])('a malformed pre-fill is dropped, the link still works: %j', (q) => {
    const { signAppLink, verifyAppLink } = load();
    const p = verifyAppLink(signAppLink(USER, 'assessment_report', null, q));
    expect(p).toEqual(expect.objectContaining({ f: 'assessment_report', q: null }));
  });
});

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ v2 = true } = {}) {
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
    req.session = s; next();
  });
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
  test('lands on the class step with grade, subject, chapter and origin=report', async () => {
    const t = load().signAppLink(USER, 'assessment_report', null, Q);
    const to = await location(await app(), `/go/${t}`);
    const u = new URL(to, 'http://x');
    expect(u.pathname).toBe('/portal/teacher/assessment/new/class');
    expect(Object.fromEntries(u.searchParams)).toEqual({ origin: 'report', grade: '3', subject: 'english', chapter: '4' });
  });

  test('no pre-fill: the class step, origin=report only', async () => {
    const to = await location(await app(), `/go/${load().signAppLink(USER, 'assessment_report')}`);
    expect(to).toBe('/portal/teacher/assessment/new/class?origin=report');
  });

  test('off the teacher app: today\'s portal home, no query', async () => {
    const to = await location(await app({ v2: false }), `/go/${load().signAppLink(USER, 'assessment_report', null, Q)}`);
    expect(to).toBe('/portal/dashboard');
  });

  test('every other landing is unchanged', async () => {
    const to = await location(await app(), `/go/${load().signAppLink(USER, 'assessment_topics')}`);
    expect(to).toBe('/portal/teacher/assessment/new/class?by=topics');
  });
});
