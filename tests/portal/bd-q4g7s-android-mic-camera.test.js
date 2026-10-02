/**
 * bd-q4g7s — the NIETE app can record a lesson and photograph a lesson plan.
 *
 * "Record your class" records with getUserMedia + MediaRecorder inside the
 * WebView. Capacitor's BridgeWebChromeClient grants an AUDIO_CAPTURE request only
 * for permissions the MANIFEST declares: RECORD_AUDIO + MODIFY_AUDIO_SETTINGS.
 * Before this the manifest declared INTERNET alone, so getUserMedia was refused.
 *
 * NO CAMERA (bd-q4g7s.1). "Take a photo" uses <input accept="image/*" capture>;
 * Capacitor sends that to the camera app with no permission at all while CAMERA
 * is NOT declared (isMediaCaptureSupported), and declaring it only adds a runtime
 * prompt before the camera opens. No storage or media permissions either
 * (READ_EXTERNAL_STORAGE, READ_MEDIA_*): every file comes through the system
 * picker, which needs none, and Play makes broad photo/video access be declared.
 *
 * Declaring RECORD_AUDIO makes Play IMPLY a microphone is required and hide the
 * app from phones without one; the feature is declared optional.
 *
 * A 40-minute recording also needs the screen to stay on — an Android app in
 * the background loses the microphone. The KeepScreen plugin sets
 * FLAG_KEEP_SCREEN_ON while a recording runs; it must be registered before
 * BridgeActivity.onCreate builds the bridge, or the web code cannot see it.
 *
 * These are file guards; the acceptance test is a real handset (see bead).
 */

const fs = require('fs');
const path = require('path');

const ANDROID = path.join(__dirname, '../../portal/android/app');
const MANIFEST = path.join(ANDROID, 'src/main/AndroidManifest.xml');
const JAVA = path.join(ANDROID, 'src/main/java/pk/edu/niete');
const GRADLE = path.join(ANDROID, 'build.gradle');

const strip = (src) => src.replace(/<!--[\s\S]*?-->/g, '');
const stripJava = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('bd-q4g7s — the app may use the microphone and the camera', () => {
  const manifest = strip(fs.readFileSync(MANIFEST, 'utf8'));
  const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((m) => m[1]);

  test.each([
    'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS',
  ])('declares %s', (perm) => {
    expect(permissions).toContain(perm);
  });

  test('declares nothing beyond the network and the microphone — no CAMERA, no storage or media access', () => {
    expect([...permissions].sort()).toEqual([
      'android.permission.INTERNET',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.RECORD_AUDIO',
    ]);
  });

  test('the microphone is optional, so Play does not hide the app from phones without one', () => {
    const tag = manifest.match(/<uses-feature[^>]*android:name="android\.hardware\.microphone"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag[0]).toMatch(/android:required="false"/);
  });
});

describe('bd-q4g7s — KeepScreen keeps the screen on while she records', () => {
  const pluginPath = path.join(JAVA, 'KeepScreenPlugin.java');

  test('the plugin exists, is named KeepScreen, and toggles FLAG_KEEP_SCREEN_ON on the UI thread', () => {
    expect(fs.existsSync(pluginPath)).toBe(true);
    const src = stripJava(fs.readFileSync(pluginPath, 'utf8'));
    expect(src).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"KeepScreen"\s*\)/);
    expect(src).toMatch(/@PluginMethod[\s\S]*?void\s+on\s*\(\s*PluginCall/);
    expect(src).toMatch(/@PluginMethod[\s\S]*?void\s+off\s*\(\s*PluginCall/);
    expect(src).toMatch(/addFlags\(\s*WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\s*\)/);
    expect(src).toMatch(/clearFlags\(\s*WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\s*\)/);
    expect(src).toMatch(/runOnUiThread/);
  });

  test('MainActivity registers it before the bridge is built, and keeps the cookie flush', () => {
    const src = stripJava(fs.readFileSync(path.join(JAVA, 'MainActivity.java'), 'utf8'));
    const register = src.search(/registerPlugin\(\s*KeepScreenPlugin\.class\s*\)/);
    const superCreate = src.search(/super\.onCreate\(/);
    expect(register).toBeGreaterThan(-1);
    expect(superCreate).toBeGreaterThan(register);
    expect(src).toMatch(/CookieManager\.getInstance\(\)\.flush\(\)/);
  });
});

describe('bd-q4g7s.1 — the release that carries the microphone', () => {
  const code = Number(fs.readFileSync(GRADLE, 'utf8').match(/versionCode\s+(\d+)/)[1]);
  const support = fs.readFileSync(path.join(__dirname, '../../portal/src/portal/lib/recordingSupport.ts'), 'utf8');
  const micBuild = Number((support.match(/MIC_APP_BUILD\s*=\s*(\d+)/) || [])[1]);

  // A 1215 bundle was built for Play on 2026-09-10 (~/niete-builds/niete-rumi-v1215.aab)
  // from code with no RECORD_AUDIO. Play only takes a higher code, and an
  // install of 1215 must never be shown "Record now".
  test('versionCode is at least 1216 — above the 1215 already built for Play', () => {
    expect(code).toBeGreaterThanOrEqual(1216);
  });

  test('the web code shows "Record now" from 1216 (the first build with the microphone), and this build is one', () => {
    expect(micBuild).toBeGreaterThanOrEqual(1216);
    expect(code).toBeGreaterThanOrEqual(micBuild);
  });
});
