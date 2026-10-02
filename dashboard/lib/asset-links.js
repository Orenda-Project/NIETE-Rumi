/**
 * Android App Links — the Digital Asset Links file for the portal host.
 *
 * Android lets the NIETE app open portal links directly (no browser, no
 * "Open with…" chooser) only after it fetches
 * https://<portal-host>/.well-known/assetlinks.json and finds the app's package
 * name and signing-certificate SHA-256 in it. Without a real JSON answer here
 * the path falls through to the SPA catch-all, which serves index.html as
 * text/html, and verification fails.
 *
 * Configured per deployment, because each one pairs with a different build:
 *
 *   ANDROID_APP_PACKAGE              e.g. the production package, or the staging
 *                                    build's suffixed package
 *   ANDROID_APP_SHA256_FINGERPRINTS  comma/space separated. For a Play-distributed
 *                                    app this MUST include the Play APP-SIGNING
 *                                    certificate (Play Console → App integrity),
 *                                    not only the upload key: Play re-signs the
 *                                    app, so the upload key never reaches a phone.
 *
 * Fails closed: if either value is missing or malformed the endpoint answers a
 * JSON 404 instead of a partial statement, so a typo can never pin the wrong
 * app — links simply keep opening in the browser.
 *
 * Kept as its own tiny module so the rule is unit-testable without booting the
 * Express app.
 */

const ASSET_LINKS_PATH = '/.well-known/assetlinks.json';

// Java package name: two or more dot-separated identifiers.
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
// SHA-256 certificate fingerprint: 32 colon-separated hex bytes.
const SHA256_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/**
 * @param {Record<string, string|undefined>} env  usually process.env
 * @returns {Array<object>|null}  the assetlinks.json body, or null when not
 *   (correctly) configured
 */
function buildAssetLinks(env) {
  const pkg = typeof env?.ANDROID_APP_PACKAGE === 'string' ? env.ANDROID_APP_PACKAGE.trim() : '';
  const raw = typeof env?.ANDROID_APP_SHA256_FINGERPRINTS === 'string' ? env.ANDROID_APP_SHA256_FINGERPRINTS : '';

  if (!PACKAGE_RE.test(pkg)) return null;

  // keytool prints "SHA256: AA:BB:…"; accept a pasted line as-is.
  const tokens = raw
    .replace(/SHA-?256:\s*/gi, ' ')
    .split(/[\s,]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (tokens.length === 0 || !tokens.every((t) => SHA256_RE.test(t))) return null;

  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: [...new Set(tokens)],
      },
    },
  ];
}

/** Express handler for GET ASSET_LINKS_PATH. Reads env per request. */
function assetLinksHandler(req, res) {
  const statements = buildAssetLinks(process.env);
  if (!statements) {
    return res.status(404).json({ error: 'App Links are not configured on this deployment' });
  }
  return res.status(200).json(statements);
}

module.exports = { ASSET_LINKS_PATH, buildAssetLinks, assetLinksHandler };
