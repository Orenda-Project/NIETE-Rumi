/**
 * Android App Links — the native half.
 *
 * Three pieces have to be in the APK for a tapped portal link to open the NIETE
 * app on the right page, and none of them can be shipped over the air:
 *
 *   1. An autoVerify intent filter on MainActivity, so Android checks the
 *      portal's assetlinks.json and routes matching links straight to the app.
 *      Its host comes from VITE_API_BASE_URL (the one configured host that
 *      OTA and allowNavigation already use), so a staging build claims staging.
 *   2. @capacitor/app, because Capacitor's bridge keeps the launch link but
 *      always loads the start page; only a plugin hands the link to the web
 *      code (`appUrlOpen`), which then routes to it.
 *   3. That plugin's back-button takeover switched OFF. Left on, it changes the
 *      hardware back key for every user (at the first screen it would do
 *      nothing instead of leaving the app). This change is about links only.
 *
 * Scope is deliberately narrow for the first release: exactly /portal/dashboard
 * and /portal/login. Widening it is a manifest change (a Play release); the web
 * side already accepts any /portal/ page.
 *
 * Source-level guards — the real acceptance test is a tap on a physical device.
 */

const fs = require('fs');
const path = require('path');

const PORTAL = path.join(__dirname, '../../portal');
const read = (p) => fs.readFileSync(path.join(PORTAL, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(PORTAL, p));

const hasNativeShell = exists('android/app/src/main/AndroidManifest.xml');
const maybe = hasNativeShell ? it : it.skip;

const stripXmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripCodeComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('AndroidManifest — App Links intent filter', () => {
  const manifest = hasNativeShell ? stripXmlComments(read('android/app/src/main/AndroidManifest.xml')) : '';
  const activity = (manifest.match(/<activity[\s\S]*?<\/activity>/) || [''])[0];
  const filters = activity.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) || [];
  const appLinks = filters.find((f) => /android\.intent\.action\.VIEW/.test(f)) || '';
  const dataPaths = [...appLinks.matchAll(/android:path="([^"]*)"/g)].map((m) => m[1]).sort();

  maybe('declares a VIEW filter on MainActivity with autoVerify', () => {
    expect(activity).toMatch(/android:name="\.MainActivity"/);
    expect(appLinks).not.toBe('');
    expect(appLinks).toMatch(/<intent-filter[^>]*android:autoVerify="true"/);
  });

  maybe('is browsable from other apps (WhatsApp, Chrome)', () => {
    expect(appLinks).toMatch(/android:name="android\.intent\.category\.DEFAULT"/);
    expect(appLinks).toMatch(/android:name="android\.intent\.category\.BROWSABLE"/);
  });

  maybe('claims https on the build-configured host only', () => {
    const schemes = [...appLinks.matchAll(/android:scheme="([^"]*)"/g)].map((m) => m[1]);
    const hosts = [...appLinks.matchAll(/android:host="([^"]*)"/g)].map((m) => m[1]);
    expect(schemes).toEqual(['https']);
    expect(hosts).toEqual(['${deepLinkHost}']);
  });

  maybe('claims exactly /portal/dashboard and /portal/login — nothing broader', () => {
    expect(dataPaths).toEqual(['/portal/dashboard', '/portal/login']);
    expect(manifest).not.toMatch(/android:path(Prefix|Pattern|AdvancedPattern|Suffix)=/);
  });

  maybe('keeps the launcher entry and singleTask (links reuse the running app)', () => {
    expect(activity).toMatch(/android\.intent\.category\.LAUNCHER/);
    expect(activity).toMatch(/android:launchMode="singleTask"/);
  });
});

describe('build.gradle — the App Links host comes from VITE_API_BASE_URL', () => {
  const gradle = hasNativeShell ? stripCodeComments(read('android/app/build.gradle')) : '';

  maybe('supplies the deepLinkHost manifest placeholder', () => {
    expect(gradle).toMatch(/deepLinkHost/);
    expect(gradle).toMatch(/manifestPlaceholders[\s\S]*deepLinkHost/);
  });

  maybe('reads VITE_API_BASE_URL from the environment, then portal/.env.app', () => {
    expect(gradle).toMatch(/System\.getenv\(\s*['"]VITE_API_BASE_URL['"]\s*\)/);
    expect(gradle).toMatch(/\.env\.app/);
  });

  maybe('fails the build loudly when no https host can be derived', () => {
    expect(gradle).toMatch(/GradleException/);
    expect(gradle).toMatch(/preBuild/);
  });
});

describe('@capacitor/app — hands the link to the web code', () => {
  const pkg = JSON.parse(read('package.json'));
  const major = (v) => String(v || '').replace(/^[^\d]*/, '').split('.')[0];

  it('is a dependency at the same major as @capacitor/core', () => {
    expect(pkg.dependencies['@capacitor/app']).toBeDefined();
    expect(major(pkg.dependencies['@capacitor/app'])).toBe(major(pkg.dependencies['@capacitor/core']));
  });

  maybe('is registered in the native project (cap update / sync output is committed)', () => {
    expect(read('android/capacitor.settings.gradle')).toMatch(/include ':capacitor-app'/);
    expect(read('android/app/capacitor.build.gradle')).toMatch(/implementation project\(':capacitor-app'\)/);
  });

  it('has its back-button takeover disabled, so the back key behaves as before', () => {
    const config = stripCodeComments(read('capacitor.config.ts'));
    expect(config).toMatch(/plugins\s*:\s*\{[\s\S]*App\s*:\s*\{[\s\S]*disableBackButtonHandler\s*:\s*true/);
  });
});
