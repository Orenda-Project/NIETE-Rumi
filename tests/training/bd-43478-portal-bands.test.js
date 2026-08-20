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
    expect(SRC).toMatch(/require\('\.\.\/\.\.\/bot\/shared\/services\/training\/band-selection\.service'\)/);
    expect(SRC).toMatch(/applyBandSelection/);
    // The mapping itself must not be re-implemented here.
    expect(SRC).not.toMatch(/niete_middle_high['"]\s*\]/);
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
    const block = SRC.slice(SRC.indexOf("router.get('/training/bands'"),
                            SRC.indexOf("router.get('/training/vendors'"));
    for (const key of ['options', 'selected', 'can_change', 'notice']) {
      expect(block).toContain(key);
    }
  });

  test('the GET selects only the two band columns — never users.levels', () => {
    const block = SRC.slice(SRC.indexOf("router.get('/training/bands'"),
                            SRC.indexOf("router.get('/training/vendors'"));
    expect(block).toMatch(/training_bands, training_bands_updated_at/);
    expect(block).not.toMatch(/select\('[^']*\blevels\b/);
  });
});
