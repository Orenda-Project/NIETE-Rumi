'use strict';
/**
 * bd-pw1ccr.4.2 — the topic-end nudge button: one tap opens the paper generator on the Topics step for the chapter she
 * just finished (portal: linkPicks.readTopicLink, bd-pw1ccr.4.3). The pre-fill rides INSIDE the encrypted token, like
 * the report button's, but the paper is not tagged: the landing carries by=topics and no origin.
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
  test('assessment_topic_nudge carries the pre-fill through the token', () => {
    const { signAppLink, verifyAppLink } = load();
    const p = verifyAppLink(signAppLink(USER, 'assessment_topic_nudge', null, Q));
    expect(p).toEqual(expect.objectContaining({ f: 'assessment_topic_nudge', q: Q }));
  });

  test('a malformed pre-fill is dropped, the link still works', () => {
    const { signAppLink, verifyAppLink } = load();
    const p = verifyAppLink(signAppLink(USER, 'assessment_topic_nudge', null, { ...Q, grade: 13 }));
    expect(p).toEqual(expect.objectContaining({ f: 'assessment_topic_nudge', q: null }));
  });
});

describe('landingQuery', () => {
  test('by=topics plus the chapter, no origin', () => {
    expect(load().landingQuery({ f: 'assessment_topic_nudge', q: Q })).toBe('?by=topics&grade=3&subject=english&chapter=4');
  });

  test('no pre-fill: by=topics alone', () => {
    expect(load().landingQuery({ f: 'assessment_topic_nudge', q: null })).toBe('?by=topics');
  });

  test('the report button is unchanged', () => {
    expect(load().landingQuery({ f: 'assessment_report', q: Q })).toBe('?origin=report&grade=3&subject=english&chapter=4');
  });
});

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app() {
  const a = express();
  a.use((req, _res, next) => {
    req.session = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
    next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === USER ? { id: USER, name: 'Ayesha' } : null),
    isTeacherV2: async () => true,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const location = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { res.resume(); resolve(res.headers.location); }).on('error', reject);
});

test('redeem lands on the class step with by=topics and the chapter, no origin', async () => {
  const t = load().signAppLink(USER, 'assessment_topic_nudge', null, Q);
  const u = new URL(await location(await app(), `/go/${t}`), 'http://x');
  expect(u.pathname).toBe('/portal/teacher/assessment/new/class');
  expect(Object.fromEntries(u.searchParams)).toEqual({ by: 'topics', grade: '3', subject: 'english', chapter: '4' });
});
