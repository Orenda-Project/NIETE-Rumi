import { isNativeApp } from '@/lib/runtime';
import { resolveDownloadUrl, toViewUrl } from '../../components/CertificatesPanel';

/**
 * bd-5rz1v.25 — a certificate's PDF, opened exactly as CertificatesPanel opens it (bd-2397,
 * bd-2676), through a real anchor so nothing replaces the portal's page by accident:
 *
 *   Download  web: a new tab (the url is a file; her place in the portal stays).
 *             the app: NO _blank — in the Capacitor WebView that hands the url to external
 *             Chrome, which has none of the session cookies (401). In place, the WebView
 *             passes the file to Android's download manager.
 *   View      web only, in place, with ?view=1 (an inline disposition). The app has no PDF
 *             viewer, so View would only download again: canView() is false there.
 *
 * The server's url is root-relative; resolveDownloadUrl puts the API's origin on it in the app.
 */
function follow(href: string, newTab: boolean): void {
  const a = document.createElement('a');
  a.href = href;
  if (newTab) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}

export function downloadCertificate(downloadUrl: string): void {
  follow(resolveDownloadUrl(downloadUrl), !isNativeApp());
}

export const canView = () => !isNativeApp();

export function viewCertificate(downloadUrl: string): void {
  follow(resolveDownloadUrl(toViewUrl(downloadUrl)), false);
}

/** The download route for a certificate code (LevelCertificateRow's link). */
export const certificateUrl = (code: string) => `/api/portal/training/certificates/${encodeURIComponent(code)}/download`;

/** A file that is not ours to sign (a part's handout on R2): a new tab, as the old page's link did. */
export function openInNewTab(url: string): void {
  follow(url, true);
}
