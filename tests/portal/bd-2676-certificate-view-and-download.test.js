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

describe('bd-2676 — the certificate row offers View as well as Download', () => {
  it('renders a View control, not only a Download one', () => {
    const src = read(PANEL);
    expect(src).toContain('data-testid="certificate-view"');
    expect(src).toContain('data-testid="certificate-download"');
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
