'use strict';
/**
 * bd-t7zk3t.12 (PR-D) — the ONE hook line in m-app's `dashboard/routes/portal-fln.routes.js`:
 *   router.use(require('./portal-fln-links.routes'));
 * Loads m-app's router as dashboard/index.js does (DB + telemetry mocked at the boundary) and walks its stack: the
 * leader routes must be reachable through it, each behind no-store.
 */
jest.mock('../../dashboard/config/supabase', () => ({ from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q; } }));
jest.mock('../../dashboard/config/database', () => ({ query: async () => ({ rows: [] }) }));
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => false }));

function routesOf(stack, out = []) {
  for (const layer of stack) {
    if (layer.route) out.push({ path: layer.route.path, methods: Object.keys(layer.route.methods), first: layer.route.stack[0].handle });
    else if (layer.handle && layer.handle.stack) routesOf(layer.handle.stack, out);
  }
  return out;
}

test('m-app\'s FLN router carries /fln/links and /fln/title/:id, each behind no-store first', () => {
  const router = require('../../dashboard/routes/portal-fln.routes');
  const { noStore } = require('../../dashboard/lib/fln-access');
  const all = routesOf(router.stack);
  for (const p of ['/fln/links', '/fln/title/:id']) {
    const r = all.find((x) => x.path === p);
    expect(r && r.methods).toEqual(['get']);
    expect(r.first).toBe(noStore);
  }
});
