/**
 * bd-q4g7s — the NIETE app can record a lesson and photograph a lesson plan.
 *
 * "Record your class" records with getUserMedia + MediaRecorder inside the
 * WebView, and "Take a photo" opens the camera from <input capture>. Capacitor's
 * BridgeWebChromeClient grants both — but only for permissions the MANIFEST
 * declares: an AUDIO_CAPTURE request needs RECORD_AUDIO + MODIFY_AUDIO_SETTINGS,
 * and once CAMERA is declared the camera capture asks for it at runtime. Before
 * this the manifest declared INTERNET alone, so getUserMedia was refused.
 *
 * Declaring a hardware permission makes Play IMPLY that hardware is required
 * and hide the app from phones without it. Both features are declared optional:
 * a phone with no camera can still record, and the reverse.
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
    'android.permission.CAMERA',
  ])('declares %s', (perm) => {
    expect(permissions).toContain(perm);
  });

  test('declares nothing beyond what recording, photos and the network need', () => {
    expect([...permissions].sort()).toEqual([
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.RECORD_AUDIO',
    ]);
  });

  test.each(['android.hardware.microphone', 'android.hardware.camera'])(
    '%s is optional, so Play does not hide the app from phones without it',
    (feature) => {
      const tag = manifest.match(new RegExp(`<uses-feature[^>]*android:name="${feature.replace(/\./g, '\\.')}"[^>]*>`));
      expect(tag).not.toBeNull();
      expect(tag[0]).toMatch(/android:required="false"/);
    },
  );
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

describe('bd-q4g7s — the release that carries the permissions', () => {
  test('versionCode is at least 1214, the first build that may record (the web code gates "Record now" on it)', () => {
    const code = Number(fs.readFileSync(GRADLE, 'utf8').match(/versionCode\s+(\d+)/)[1]);
    expect(code).toBeGreaterThanOrEqual(1214);
  });
});
