/**
 * bd-4ryvw — the NIETE app saves a certificate itself instead of handing it to Chrome.
 *
 * The certificate route 302s to a signed R2 url. In the WebView that navigation goes to
 * R2's host, which is not in allowNavigation, so Capacitor hands it to Android and the
 * teacher lands in Chrome. The portal now fetches the signed link as JSON and passes it to
 * a local plugin, CertificateFile, which downloads the PDF, saves it to Downloads (Android
 * 10+, MediaStore — no permission) and opens it with the phone's PDF viewer.
 *
 * File guards, like bd-q4g7s: the acceptance test is a real handset (see the bead).
 */

const fs = require('fs');
const path = require('path');

const ANDROID = path.join(__dirname, '../../portal/android/app/src/main');
const JAVA = path.join(ANDROID, 'java/pk/edu/niete');
const stripJava = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('bd-4ryvw — CertificateFile plugin', () => {
  const pluginPath = path.join(JAVA, 'CertificateFilePlugin.java');

  test('exists and is a Capacitor plugin named CertificateFile with a save method', () => {
    expect(fs.existsSync(pluginPath)).toBe(true);
    const src = stripJava(fs.readFileSync(pluginPath, 'utf8'));
    expect(src).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"CertificateFile"\s*\)/);
    expect(src).toMatch(/@PluginMethod[\s\S]*?public\s+void\s+save\s*\(\s*PluginCall/);
  });

  test('never runs the download on the main thread', () => {
    const src = stripJava(fs.readFileSync(pluginPath, 'utf8'));
    expect(src).toMatch(/new\s+Thread\s*\(|Executors?\./);
  });

  test('fetches only https urls', () => {
    const src = stripJava(fs.readFileSync(pluginPath, 'utf8'));
    expect(src).toMatch(/"https"/);
  });

  test('saves to Downloads through MediaStore and opens the file through the FileProvider', () => {
    const src = stripJava(fs.readFileSync(pluginPath, 'utf8'));
    expect(src).toMatch(/MediaStore\.Downloads/);
    expect(src).toMatch(/FileProvider\.getUriForFile/);
    expect(src).toMatch(/FLAG_GRANT_READ_URI_PERMISSION/);
  });

  test('is registered BEFORE super.onCreate, or the web code never sees it', () => {
    const src = stripJava(fs.readFileSync(path.join(JAVA, 'MainActivity.java'), 'utf8'));
    const reg = src.indexOf('registerPlugin(CertificateFilePlugin.class)');
    const sup = src.indexOf('super.onCreate(');
    expect(reg).toBeGreaterThan(-1);
    expect(reg).toBeLessThan(sup);
  });

  test('the FileProvider can serve the cache folder the plugin writes to', () => {
    const xml = fs.readFileSync(path.join(ANDROID, 'res/xml/file_paths.xml'), 'utf8');
    expect(xml).toMatch(/<cache-path\b/);
  });
});
