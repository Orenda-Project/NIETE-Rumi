'use strict';
/**
 * bd-t7zk3t.11 — [sandbox-only] the template-link scope guard (dashboard/routes/portal-link.routes.js, absent on main)
 * must admit the FLN API for a `lessons` link session, and only for it. Executes portalLinkScope itself.
 */
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => false }));
const { portalLinkScope } = require('../../dashboard/routes/portal-link.routes');

function through(area, method, path) {
  const req = { session: { portalScope: area }, method, path };
  let status = null; let passed = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  portalLinkScope(req, res, () => { passed = true; });
  return passed ? 'next' : status;
}

test('a lessons-scoped session reaches the FLN reads and the events post', () => {
  expect(through('lessons', 'GET', '/fln/catalogue')).toBe('next');
  expect(through('lessons', 'GET', '/fln/plan/900003')).toBe('next');
  expect(through('lessons', 'GET', '/fln/me')).toBe('next');
  expect(through('lessons', 'POST', '/fln/events')).toBe('next');
});

test('a lessons session cannot post anything else under /fln, and a training one reaches none of it', () => {
  expect(through('lessons', 'POST', '/fln/send')).toBe(403);
  expect(through('lessons', 'GET', '/flnx')).toBe(403);
  expect(through('training', 'GET', '/fln/catalogue')).toBe(403);
  expect(through('training', 'GET', '/fln/plan/900003')).toBe(403);
  expect(through('training', 'POST', '/fln/events')).toBe(403);
});

test('existing lessons paths are unchanged', () => {
  expect(through('lessons', 'GET', '/curriculum/books')).toBe('next');
  expect(through('lessons', 'POST', '/lp612/request')).toBe('next');
});

test('a lessons-scoped session cannot read the leader teacher list (red-team 165713 note 3)', () => {
  expect(through('lessons', 'GET', '/fln/teachers')).toBe(403);
  expect(through('lessons', 'GET', '/fln/teachers/x')).toBe(403);
  expect(through('lessons', 'GET', '/fln/title/900003')).toBe('next');
});
