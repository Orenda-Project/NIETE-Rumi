'use strict';
/**
 * bd-4r3rei — wiring guard for dashboard/index.js, which no suite loads (Class T: green tests, unbootable service).
 * The action logger must be mounted BEFORE the routers it watches, and the funnel endpoint must be reachable on the
 * same CORS stack as the other portal routes; a syntax check of the entry file is part of the push gate.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const INDEX = path.join(__dirname, '..', '..', 'dashboard', 'index.js');
const src = fs.readFileSync(INDEX, 'utf8');
const at = (needle) => { const i = src.indexOf(needle); expect(i).toBeGreaterThan(-1); return i; };

test('the entry file parses', () => {
  expect(() => execFileSync(process.execPath, ['--check', INDEX])).not.toThrow();
});

test('actionLogger is mounted before the portal routers, after the link-area scope', () => {
  const scope = at("app.use('/api/portal', portalLinkRoutes.portalLinkScope);");
  const logger = at("app.use('/api/portal', appFunnelRoutes.actionLogger);");
  const portal = at("app.use('/api/portal', cors(portalCorsOptions), portalAuthLimiter, portalDataLimiter, portalRoutes);");
  const lessons = at('teacherLessonsRoutes);');
  expect(scope).toBeLessThan(logger);
  expect(logger).toBeLessThan(portal);
  expect(logger).toBeLessThan(lessons);
});

test('the funnel endpoint is mounted with the portal CORS options (the Android app calls it cross-origin, with cookies)', () => {
  const m = at("app.use('/api/portal', cors(portalCorsOptions), appFunnelRoutes.createAppFunnelRouter());");
  expect(m).toBeLessThan(at("app.use('/api/portal', cors(portalCorsOptions), portalAuthLimiter, portalDataLimiter, portalRoutes);"));
});
