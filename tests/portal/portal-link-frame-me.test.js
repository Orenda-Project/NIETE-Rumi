'use strict';
/**
 * bd-enec2e.5 — a /t/<token> link session must be able to read who she is and switch her language, in every area.
 *
 * Found on NIETE sandbox (7 Nov, the coach report e2e): the "Open my report" link landed on the report, then went to
 * /portal/login. Since bd-fxk3t8 the app asks GET /api/portal/me who is signed in, and a 403 there means "not signed
 * in" (hooks/useAuth.ts readSessionUser) — but the link scope's FRAME allowed /dashboard and /auth/verify, not /me,
 * so every link area's session answered 403 and was sent to the sign-in. And the page's language pill saves first
 * (PUT /me/language, the one writer) and only then turns the page, so a link session could not switch language.
 *
 * The frame grows by exactly these two; everything else a link session may call is still its own area's.
 */
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true }));

const { portalLinkScope } = require('../../dashboard/routes/portal-link.routes');

const AREAS = ['training', 'lessons', 'ready', 'coachreport'];
const allowed = (area, method, path) => {
  let passed = false;
  let status = null;
  const req = { method, path, session: { portalScope: area } };
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  portalLinkScope(req, res, () => { passed = true; });
  return passed && status === null;
};

test.each(AREAS)('a %s link session can read who she is (GET /me), as the app asks at every start', (area) => {
  expect(allowed(area, 'GET', '/me')).toBe(true);
});

test.each(AREAS)('a %s link session can switch her language (PUT /me/language, the one writer)', (area) => {
  expect(allowed(area, 'PUT', '/me/language')).toBe(true);
  expect(allowed(area, 'GET', '/me/language')).toBe(true);
});

test.each(AREAS)('a %s link session still cannot write to /me, nor reach her other /me reads', (area) => {
  for (const [m, p] of [['PUT', '/me'], ['POST', '/me'], ['DELETE', '/me'], ['POST', '/me/language'], ['PUT', '/me/profile'], ['GET', '/me/classes'], ['GET', '/me/coaching']]) {
    expect(allowed(area, m, p)).toBe(false);
  }
});

test('a password session is untouched by the scope', () => {
  let passed = false;
  portalLinkScope({ method: 'PUT', path: '/me', session: {} }, {}, () => { passed = true; });
  expect(passed).toBe(true);
});
