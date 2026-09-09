/**
 * bd-60063 — the portal's LP *render* endpoint is retired, and must stay gone.
 *
 * This file replaces tests/portal/lp-render-via-internal-api.test.js, which
 * proved the bd-2461 contract for POST /curriculum/lp/:uuid/render: enqueue a
 * Gamma render over the bot's internal API rather than by requiring the bot's
 * queue service in-process.
 *
 * That endpoint no longer exists. Two reasons, and either alone is sufficient:
 *
 *   1. It queued against curriculum_lp_ast — the corpus the portal no longer
 *      reads. The portal now serves the v8 K-5 catalogue the WhatsApp Flow
 *      serves, whose assets are PRE-RENDERED and uploaded. Availability (an
 *      is_current row in niete_lp_assets) is the only gate, so there is
 *      nothing for a teacher to queue.
 *   2. Gamma generation is being turned off (operator, 2026-09-08).
 *
 * bd-2461's lesson is not lost — it is the reason the replacement client
 * (dashboard/services/lp-catalogue.service.js) talks HTTP instead of requiring
 * bot code, and lp-catalogue-via-internal-api.test.js asserts exactly that.
 *
 * What this file guards: the endpoint does not quietly come back, and the
 * portal does not regrow a Gamma enqueue.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', '..', 'dashboard', 'routes', 'portal.routes.js');

/** Source with comments stripped — the docblocks describe what was removed. */
function code() {
  return fs.readFileSync(ROUTES, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('bd-60063 — the LP render endpoint stays retired', () => {
  test('no /curriculum/lp/:uuid/render route is registered', () => {
    expect(code()).not.toMatch(/curriculum\/lp\/:[a-z_]+\/render/);
  });

  test('the portal enqueues no lesson-plan render of any kind', () => {
    const src = code();
    expect(src).not.toMatch(/queue-lesson-plan/);
    expect(src).not.toMatch(/createAndQueueGrounded/);
  });

  test('the portal still never requires the bot queue service in-process (bd-2461)', () => {
    expect(code()).not.toMatch(/require\([^)]*lesson-plan-queue\.service/);
  });
});
