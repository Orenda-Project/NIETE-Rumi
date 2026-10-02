/**
 * Android App Links — the portal must publish a real Digital Asset Links file.
 *
 * Android only lets the NIETE app open portal links directly (no "Open with…"
 * chooser, no browser) after it downloads
 * https://<portal-host>/.well-known/assetlinks.json and finds the app's package
 * and signing-certificate fingerprint in it.
 *
 * Before this, that path fell through to the SPA catch-all and answered
 * `200 text/html` with index.html, which Google's verifier rejects ("expected
 * Content-Type: application/json"). So verification could never succeed, and
 * every link kept opening in the browser.
 *
 * The statement is built from environment (package + fingerprints differ per
 * deployment: production app vs the staging build), and when that config is
 * absent or malformed the endpoint answers a JSON 404 — never the SPA page,
 * and never a half-built statement that would pin the wrong app.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');

const {
  ASSET_LINKS_PATH,
  buildAssetLinks,
  assetLinksHandler,
} = require('../../dashboard/lib/asset-links');

const FP_A = 'DA:A4:A5:FB:CF:D7:20:6F:40:41:DB:1C:EE:BF:D4:1E:E2:8E:91:E6:25:3F:49:26:65:F5:06:C0:44:CA:36:2C';
const FP_B = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';

describe('buildAssetLinks', () => {
  it('builds the handle_all_urls statement for one app and fingerprint', () => {
    expect(
      buildAssetLinks({ ANDROID_APP_PACKAGE: 'pk.edu.niete', ANDROID_APP_SHA256_FINGERPRINTS: FP_A })
    ).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'pk.edu.niete',
          sha256_cert_fingerprints: [FP_A],
        },
      },
    ]);
  });

  it('accepts several fingerprints (Play app-signing key + upload key), comma or space separated', () => {
    const [stmt] = buildAssetLinks({
      ANDROID_APP_PACKAGE: 'pk.edu.niete',
      ANDROID_APP_SHA256_FINGERPRINTS: `${FP_A}, ${FP_B}\n${FP_A}`,
    });
    expect(stmt.target.sha256_cert_fingerprints).toEqual([FP_A, FP_B]);
  });

  it('normalises lower case and the "SHA256:" prefix keytool prints', () => {
    const [stmt] = buildAssetLinks({
      ANDROID_APP_PACKAGE: 'pk.edu.niete',
      ANDROID_APP_SHA256_FINGERPRINTS: `SHA256: ${FP_A.toLowerCase()}`,
    });
    expect(stmt.target.sha256_cert_fingerprints).toEqual([FP_A]);
  });

  it.each([
    ['nothing set', {}],
    ['no package', { ANDROID_APP_SHA256_FINGERPRINTS: FP_A }],
    ['no fingerprint', { ANDROID_APP_PACKAGE: 'pk.edu.niete' }],
    ['blank values', { ANDROID_APP_PACKAGE: '  ', ANDROID_APP_SHA256_FINGERPRINTS: ' ' }],
    ['not a package name', { ANDROID_APP_PACKAGE: 'pk edu niete', ANDROID_APP_SHA256_FINGERPRINTS: FP_A }],
    ['a SHA-1, not a SHA-256', { ANDROID_APP_PACKAGE: 'pk.edu.niete', ANDROID_APP_SHA256_FINGERPRINTS: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD' }],
    ['one good and one malformed fingerprint', { ANDROID_APP_PACKAGE: 'pk.edu.niete', ANDROID_APP_SHA256_FINGERPRINTS: `${FP_A},not-a-fingerprint` }],
  ])('returns null (fail closed) for %s', (_label, env) => {
    expect(buildAssetLinks(env)).toBeNull();
  });
});

describe('GET /.well-known/assetlinks.json', () => {
  const ENV_KEYS = ['ANDROID_APP_PACKAGE', 'ANDROID_APP_SHA256_FINGERPRINTS'];
  let saved;
  let server;
  let base;

  beforeAll((done) => {
    const app = express();
    app.get(ASSET_LINKS_PATH, assetLinksHandler);
    // Stand-in for the portal's SPA catch-all: if the route ever falls through,
    // the test sees HTML, exactly as production did. A bare middleware rather
    // than app.get('*'): the root suite resolves Express 5, where '*' is not a
    // valid path, while the portal server runs Express 4.
    app.use((req, res) => res.type('html').send('<!doctype html><html></html>'));
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function get(urlPath) {
    return new Promise((resolve, reject) => {
      http
        .get(base + urlPath, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        })
        .on('error', reject);
    });
  }

  it('is the standard well-known path', () => {
    expect(ASSET_LINKS_PATH).toBe('/.well-known/assetlinks.json');
  });

  it('answers 200 application/json with the statement when configured', async () => {
    process.env.ANDROID_APP_PACKAGE = 'pk.edu.niete';
    process.env.ANDROID_APP_SHA256_FINGERPRINTS = FP_A;
    const res = await get(ASSET_LINKS_PATH);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(res.body)).toEqual(
      buildAssetLinks({ ANDROID_APP_PACKAGE: 'pk.edu.niete', ANDROID_APP_SHA256_FINGERPRINTS: FP_A })
    );
  });

  it('answers a JSON 404 — not the SPA page — when not configured', async () => {
    delete process.env.ANDROID_APP_PACKAGE;
    delete process.env.ANDROID_APP_SHA256_FINGERPRINTS;
    const res = await get(ASSET_LINKS_PATH);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).not.toMatch(/<html/i);
  });
});

describe('portal server wiring (dashboard/index.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/index.js'), 'utf8');

  it('mounts the asset-links route', () => {
    expect(src).toMatch(/app\.get\(\s*ASSET_LINKS_PATH\s*,\s*assetLinksHandler\s*\)/);
  });

  it('mounts it before the static SPA bundle and the SPA catch-all can answer it', () => {
    const route = src.search(/app\.get\(\s*ASSET_LINKS_PATH/);
    const spaStatic = src.indexOf("'portal-frontend', 'dist'");
    const catchAll = src.indexOf("app.get('*'");
    expect(route).toBeGreaterThan(-1);
    expect(spaStatic).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(-1);
    expect(route).toBeLessThan(spaStatic);
    expect(route).toBeLessThan(catchAll);
  });
});
