/**
 * bd-2676 — the teacher gets TWO affordances: View (inline) and Download (save).
 *
 * REPORTED (ICT priority sheet, row 9, Medium: App, all vendors):
 *   "certificates are now viewable but user is redirected to browser first and
 *    the certificate is downloading in the background. Expected Behavior: The
 *    certificates should be accessible directly."
 *
 * The report names TWO symptoms and they have TWO different causes. This file
 * pins the portal half; tests/training/bd-2676-certificate-inline-view.test.js
 * pins the presigner half.
 *
 *   "redirected to browser"    → target="_blank" on the anchor. Inside the
 *                                Capacitor WebView that hands the URL to
 *                                external Chrome, so the teacher leaves the app
 *                                before Content-Disposition is even read.
 *                                Fixing only the disposition leaves this intact.
 *
 *   "downloading in background" → Content-Disposition: attachment, signed into
 *                                the presigned URL.
 *
 * WHY TWO BUTTONS RATHER THAN JUST FLIPPING TO INLINE: a certificate genuinely
 * is something teachers save and print, which is what the original `attachment`
 * comment was protecting. Relying on the PDF viewer's own save button to cover
 * that is a bet on the Android WebView PDF toolbar being present and discoverable,
 * which varies by Android version and WebView build and is NOT verified here.
 * An explicit Download button reuses the attachment path that already works in
 * production, so neither errand depends on the viewer's chrome.
 *
 * These assert on file CONTENTS, matching portal-ui-contracts.test.js: there is
 * no TSX transform in this runner and no DOM, but each of these is a specific
 * token being present or absent in a specific file — exactly what a later edit
 * would silently undo.
 *
 * WHAT THESE CANNOT TELL YOU: whether the PDF actually renders in the Android
 * WebView. That needs a device, and it is the one thing QA must confirm.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PANEL = 'portal/src/portal/components/CertificatesPanel.tsx';
const ROUTES = 'dashboard/routes/portal.routes.js';
const CLIENT = 'dashboard/services/certificates.service.js';
const INTERNAL = 'bot/shared/routes/internal-api.routes.js';

describe('bd-2676 — View is hidden in the native app, where nothing can render a PDF', () => {
  /**
   * VERIFIED ON A HANDSET (RMX2061, Android 10, debug v1210): with the
   * cross-origin navigation fixed, View and Download behave IDENTICALLY in the
   * app — both download. Android's WebView ships no PDF viewer, so
   * `Content-Disposition: inline` arrives somewhere that cannot render it and
   * falls back to the download manager.
   *
   * Two buttons that do the same thing is worse than one: it implies a choice
   * that does not exist. So View is shown only where inline actually renders —
   * the web portal, including a phone browser.
   *
   * The predicate is isNativeApp() — the NATIVE SHELL, not screen size. A
   * mobile browser renders PDFs fine; it is the WebView that cannot. Reusing
   * the existing helper keeps one definition of "am I in the app".
   *
   * When Android gets a real in-app viewer (bundled pdf.js or a Capacitor
   * plugin), delete the branch and show View everywhere.
   */
  it('imports the native-shell predicate from the shared runtime helper', () => {
    // Not a hand-rolled userAgent sniff, and not screen width.
    const src = read(PANEL);
    expect(src).toMatch(/import\s*\{[^}]*isNativeApp[^}]*\}\s*from\s*'@\/lib\/runtime'/);
  });

  it('gates the View control on NOT being in the native app', () => {
    const src = read(PANEL);
    const testid = src.indexOf('data-testid="certificate-view"');
    expect(testid).toBeGreaterThan(-1);

    // The View anchor must sit behind a native check. Look back from the testid
    // to the guard that wraps it.
    const before = src.slice(Math.max(0, testid - 1200), testid);
    expect(before).toMatch(/!\s*(isNative|native)/);
  });

  it('still renders Download unconditionally — it is the one that works everywhere', () => {
    const src = read(PANEL);
    expect(src).toContain('data-testid="certificate-download"');
  });

  it('Download does not carry target="_blank" in the native shell', () => {
    // The observed 401: _blank in the WebView hands the url to external Chrome,
    // which holds none of the session cookies. Web keeps _blank (the url returns
    // a file, so a new tab preserves the teacher's place in the SPA), so the
    // attribute has to be CONDITIONAL rather than present or absent outright.
    const src = read(PANEL);
    const testid = src.indexOf('data-testid="certificate-download"');
    expect(testid).toBeGreaterThan(-1);

    const tagOpen = src.lastIndexOf('<a', testid);
    const downloadTag = src.slice(tagOpen, src.indexOf('>', testid));

    // No unconditional target=; if a target is set at all it is behind `native`.
    expect(downloadTag).not.toMatch(/target="_blank"/);
    expect(downloadTag).toMatch(/native\s*\?/);
  });

  it('the View control does NOT eject the app to an external browser', () => {
    // The whole first half of the bug. In the Capacitor WebView target="_blank"
    // is a hand-off to Chrome; the teacher watches the app disappear.
    //
    // Slice the View <a> ELEMENT precisely — from the '<a' that opens it to the
    // '>' that closes the tag. A looser window around the testid picks up the
    // neighbouring comment (which quotes target="_blank" while explaining why it
    // is absent) and the Download anchor (which legitimately has it), so it
    // would fail on correct code and pass on the wrong thing.
    const src = read(PANEL);
    const testid = src.indexOf('data-testid="certificate-view"');
    expect(testid).toBeGreaterThan(-1);

    const tagOpen = src.lastIndexOf('<a', testid);
    const tagEnd = src.indexOf('>', testid);
    const viewTag = src.slice(tagOpen, tagEnd);

    expect(viewTag).toContain('data-testid="certificate-view"');
    expect(viewTag).not.toContain('target=');
  });

  it('the View url asks for the inline variant', () => {
    const src = read(PANEL);
    expect(src).toMatch(/view=1|inline/);
  });
});

describe('bd-2676 — the portal download route serves both dispositions', () => {
  it('reads a query param to choose inline vs attachment', () => {
    const src = read(ROUTES);
    const route = src.slice(src.indexOf("'/training/certificates/:code/download'"));
    const handler = route.slice(0, route.indexOf('\nrouter.'));
    expect(handler).toMatch(/req\.query/);
  });

  it('still 302s to a freshly signed url rather than handing one out in the list', () => {
    // The signed url is a bearer token for the file. Minting it at click time is
    // what makes the session re-check meaningful; this must not regress into
    // embedding urls in the list response.
    const src = read(ROUTES);
    const route = src.slice(src.indexOf("'/training/certificates/:code/download'"));
    const handler = route.slice(0, route.indexOf('\nrouter.'));
    expect(handler).toContain('res.redirect(302');
  });

  it('keeps requirePortalAuth on the download route', () => {
    const src = read(ROUTES);
    expect(src).toMatch(/'\/training\/certificates\/:code\/download',\s*requirePortalAuth/);
  });

  it('distinguishes 404 (no such certificate) from 502 (could not render)', () => {
    // Collapsing these hides a rendering outage behind a not-found.
    const src = read(ROUTES);
    const route = src.slice(src.indexOf("'/training/certificates/:code/download'"));
    const handler = route.slice(0, route.indexOf('\nrouter.'));
    expect(handler).toContain('404');
    expect(handler).toContain('502');
  });
});

describe('bd-2676 — disposition threads through every layer', () => {
  it('the portal client forwards a disposition to the bot', () => {
    const src = read(CLIENT);
    expect(src).toMatch(/disposition/);
  });

  it('the bot internal route accepts a disposition from the body', () => {
    const src = read(INTERNAL);
    const route = src.slice(src.indexOf("'/training/certificate-pdf'"));
    const handler = route.slice(0, route.indexOf('\nrouter.') === -1 ? undefined : route.indexOf('\nrouter.'));
    expect(handler).toMatch(/disposition/);
  });
});
