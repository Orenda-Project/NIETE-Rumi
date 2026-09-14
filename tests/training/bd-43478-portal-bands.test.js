/**
 * bd-43478 — the portal half of band self-selection.
 *
 * GET  /portal/training/bands  → current choice + whether a change is allowed
 * POST /portal/training/bands  → save, assign programs, enforce the cooldown
 *
 * Static route-contract checks. The behavioural rules live in
 * bd-43478-band-selection.test.js and bd-43478-band-apply.test.js; this suite
 * guards the wiring that a unit test cannot see: auth on every route, the
 * shared service actually being used rather than a second copy of the mapping,
 * the right status codes, and the logging idiom this file uses.
 *
 * bd-60085 — THE TRANSPORT CHANGED; THE INVARIANTS DID NOT.
 *
 * These routes used to `require` the band service in-process, and that is what made saving
 * grades answer 500 on sandbox: the module reaches bot/shared/config/supabase.js, whose
 * `require('dotenv')` resolves from /app/bot/node_modules then /app/node_modules and never
 * /app/dashboard/node_modules where dotenv actually is. The portal installs only the root
 * package.json and never installs bot/ at all.
 *
 * So the routes now go over the internal API, exactly as certificates and the LP catalogue do.
 * Three assertions below moved layer as a result — "uses the shared service" is now about the
 * CLIENT rather than a require, and the two GET-shape checks now read the bot's endpoint. What
 * they protect is unchanged: one implementation of the band mapping, and a read that fetches
 * only the two band columns.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');

describe('portal band routes — wiring', () => {
  test('GET /training/bands exists and requires portal auth', () => {
    expect(SRC).toMatch(/router\.get\('\/training\/bands',\s*requirePortalAuth/);
  });

  test('POST /training/bands exists and requires portal auth', () => {
    expect(SRC).toMatch(/router\.post\('\/training\/bands',\s*requirePortalAuth/);
  });

  test('both routes read the user from the session, never from the request body', () => {
    // A userId taken from the body would let any authenticated teacher rewrite
    // another teacher's training access.
    const block = SRC.slice(SRC.indexOf("router.get('/training/bands'"),
                            SRC.indexOf("router.get('/training/vendors'"));
    expect(block).toMatch(/req\.session\.portalUserId/);
    expect(block).not.toMatch(/req\.body\.user_?[Ii]d/);
  });

  test('it uses the SHARED service, not a second copy of the band mapping', () => {
    // Reached over the internal API rather than required in-process (see the docblock), so the
    // assertion is that the portal delegates — and, still, that it re-implements nothing.
    expect(SRC).toMatch(/require\('\.\.\/services\/training-bands\.service'\)/);
    expect(SRC).toMatch(/TrainingBands\.applyBands/);
    // The one thing that must never come back: a second copy of the mapping.
    expect(SRC).not.toMatch(/niete_middle_high['"]\s*\]/);
    // And the in-process require that caused the 500 must stay gone — checked against CODE,
    // because the fix deliberately leaves a comment naming the require it replaced.
    const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(CODE).not.toMatch(/require\('\.\.\/\.\.\/bot\/shared\/services\/training\/band-selection\.service'\)/);

    // The service itself is still the ONE implementation — now behind the endpoint.
    const INTERNAL = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/routes/internal-api.routes.js'), 'utf8');
    expect(INTERNAL).toMatch(/applyBandSelection/);
  });

  test('the cooldown returns 429, not a silent success', () => {
    const block = SRC.slice(SRC.indexOf("router.post('/training/bands'"));
    expect(block.slice(0, 1200)).toMatch(/429/);
    expect(block.slice(0, 1200)).toMatch(/cooldown/);
  });

  test('a missing user returns 404 and a bad selection 400', () => {
    const block = SRC.slice(SRC.indexOf("router.post('/training/bands'"), SRC.indexOf("router.post('/training/bands'") + 1200);
    expect(block).toMatch(/404/);
    expect(block).toMatch(/400/);
  });

  test('errors use this file’s console.error idiom, not an unimported logger', () => {
    // logToFile is NOT imported in portal.routes.js — referencing it would throw
    // a ReferenceError from inside the catch block, turning a handled error into
    // a crash.
    const block = SRC.slice(SRC.indexOf("router.get('/training/bands'"),
                            SRC.indexOf("router.get('/training/vendors'"));
    expect(block).toMatch(/console\.error/);
    expect(block).not.toMatch(/logToFile/);
  });

  test('GET exposes the options, the selection, and the change gate', () => {
    // The portal now spreads the bot's answer, so the KEYS are asserted where they are built.
    const INTERNAL = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/routes/internal-api.routes.js'), 'utf8');
    const block = INTERNAL.slice(INTERNAL.indexOf("'/training/bands/state'"),
                                 INTERNAL.indexOf("'/training/bands/apply'"));
    for (const key of ['options', 'selected', 'can_change', 'notice']) {
      expect(block).toContain(key);
    }
    // The portal must pass them through rather than rebuilding a subset of them.
    const portalBlock = SRC.slice(SRC.indexOf("router.get('/training/bands'"),
                                  SRC.indexOf("router.get('/training/vendors'"));
    expect(portalBlock).toMatch(/TrainingBands\.getBands/);
  });

  test('the read selects only the two band columns — never users.levels', () => {
    // Same invariant, now enforced where the query lives.
    const INTERNAL = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/routes/internal-api.routes.js'), 'utf8');
    const block = INTERNAL.slice(INTERNAL.indexOf("'/training/bands/state'"),
                                 INTERNAL.indexOf("'/training/bands/apply'"));
    expect(block).toMatch(/training_bands, training_bands_updated_at/);
    expect(block).not.toMatch(/select\('[^']*\blevels\b/);
  });
});
