/**
 * bd-2553 — the Android build pipeline is not allowed to depend on a human
 * typing the right flag.
 *
 * bd-2551 is the proof this guard is needed: versionCode 1206 shipped to the
 * Play internal track carrying a WEB-mode bundle. `vite build --mode app` is
 * the step that loads portal/.env.app (supplying VITE_API_BASE_URL); it was a
 * hand-typed instruction in ANDROID.md, package.json offered only `build`
 * (web) and `build:dev`, and so the one build that reached users was the one
 * that forgot the flag. resolveApiBaseUrl() then threw at first render, React
 * never mounted, and every launch was a white screen.
 *
 * The code was already correct — it failed loudly, exactly as designed. What
 * was missing was a guardrail making the wrong build unbuildable rather than
 * merely loud. These tests are that guardrail:
 *
 *   1. A named `build:app` script exists, so the native build is a command
 *      rather than a remembered flag.
 *   2. The documented Android path invokes that script rather than re-typing
 *      the raw vite incantation.
 *   3. CI exists and builds the app bundle through the same script, so the
 *      artifact that reaches Play is the one CI produced.
 *
 * Asserting on package.json/workflow text is deliberate — the failure mode is
 * a missing line in exactly these files.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const pkgPath = path.join(REPO, 'portal/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const WORKFLOW = path.join(REPO, '.github/workflows/android-release.yml');
const ANDROID_MD = path.join(REPO, 'portal/ANDROID.md');

describe('bd-2553 — the native build is a named command, not a remembered flag', () => {
  it('portal exposes a build:app script', () => {
    expect(pkg.scripts).toHaveProperty('build:app');
  });

  it('build:app builds in app mode (the flag bd-2551 forgot)', () => {
    expect(pkg.scripts['build:app']).toMatch(/--mode\s+app/);
  });

  it('the plain build script stays web-mode (one codebase, two targets)', () => {
    // `build` feeds the website bundle. If it ever grew `--mode app` the web
    // deploy would start shipping the app's absolute API URL.
    expect(pkg.scripts.build).not.toMatch(/--mode\s+app/);
  });

  it('exposes a single command that syncs and assembles a release bundle', () => {
    // The whole point: one entry point, so no step can be skipped by hand.
    const names = Object.keys(pkg.scripts);
    expect(names).toEqual(expect.arrayContaining(['android:release']));
  });
});

describe('bd-2553 — the documented path uses the script', () => {
  const doc = fs.readFileSync(ANDROID_MD, 'utf8');

  it('ANDROID.md tells the reader to run build:app, not a raw vite flag', () => {
    expect(doc).toMatch(/npm run build:app/);
  });

  it('ANDROID.md no longer instructs a bare `vite build --mode app`', () => {
    // The raw incantation is exactly what got mistyped/forgotten at 1206.
    // Mentioning it inside a fenced note is fine; presenting it as THE step
    // is not — so we require the script to be the documented command.
    const rawAsInstruction = /^\s*(npx )?vite build --mode app\s*$/m.test(doc);
    expect(rawAsInstruction).toBe(false);
  });
});

describe('bd-2553 — CI builds and signs the release', () => {
  it('an android-release workflow exists', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  const workflow = fs.existsSync(WORKFLOW) ? fs.readFileSync(WORKFLOW, 'utf8') : '';

  it('CI builds the web assets through build:app', () => {
    expect(workflow).toMatch(/npm run build:app/);
  });

  it('CI signs from secrets and never from a committed keystore', () => {
    // The keystore reaches CI base64-encoded through a secret; a path into
    // the repo would mean the .jks got committed.
    expect(workflow).toMatch(/NIETE_KEYSTORE_B64|secrets\.NIETE_KEYSTORE/);
    expect(workflow).not.toMatch(/keystore\/niete-app\.jks/);
  });

  it('CI carries no literal keystore password', () => {
    // The legacy repo kept `storePassword 'nieteapp'` in plain text. That
    // practice does not get inherited along with the key.
    expect(workflow).not.toMatch(/nieteapp/);
  });

  it('the release job produces the versioned AAB artifact', () => {
    expect(workflow).toMatch(/bundleRelease/);
  });
});
