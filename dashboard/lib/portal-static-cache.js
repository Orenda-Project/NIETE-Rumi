/**
 * bd-fxk3t8 — how long a browser may keep the portal's files.
 *
 * Until now every file went out `public, max-age=0`, so a returning teacher's
 * browser asked again for the whole bundle before it could paint anything.
 *
 * Vite names everything it builds into /assets/ after a hash of the file's
 * content (index-B_dpDXm6.js): a given /assets/ URL never changes, so it can be
 * kept for a year without asking. index.html is the one file that names the
 * current hashes, so it is revalidated on every visit (a cheap 304 when nothing
 * changed) — that is what lets a deploy reach everyone straight away.
 *
 * Files without a content hash (favicon.png, anything copied from public/) keep
 * express's default.
 */

const PORTAL_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PORTAL_INDEX_CACHE_CONTROL = 'no-cache';

// …/assets/<name>-<hash>.<ext>; Vite's hash is 8 url-safe characters.
const HASHED_ASSET = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;
const INDEX_HTML = /[\\/]index\.html$/;

/** express.static's `setHeaders` (runs before express picks its own Cache-Control). */
function portalStaticHeaders(res, filePath) {
  if (HASHED_ASSET.test(filePath)) res.setHeader('Cache-Control', PORTAL_ASSET_CACHE_CONTROL);
  else if (INDEX_HTML.test(filePath)) res.setHeader('Cache-Control', PORTAL_INDEX_CACHE_CONTROL);
}

module.exports = {
  portalStaticHeaders,
  PORTAL_ASSET_CACHE_CONTROL,
  PORTAL_INDEX_CACHE_CONTROL,
};
