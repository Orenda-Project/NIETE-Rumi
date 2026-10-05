import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNativeApp } from '@/lib/runtime';
import api from '../../services/api';
import { resolveDownloadUrl, toViewUrl } from '../../components/CertificatesPanel';

/**
 * bd-5rz1v.25 — a certificate's PDF, opened as CertificatesPanel opens it (bd-2397, bd-2676),
 * through a real anchor so nothing replaces the portal's page by accident.
 *
 * bd-4ryvw — Download no longer navigates to the download route. That route 302s to a signed
 * R2 url, and in the app the WebView followed it to R2's host, which is not the app's own, so
 * Capacitor handed it to Chrome and the teacher left the app. On the web it opened a new tab.
 * Download now asks for the signed link (?format=json) and:
 *
 *   web           follows it IN PLACE: it is Content-Disposition: attachment, so the browser
 *                 saves the file and the page stays where it is
 *   app (plugin)  the native CertificateFile plugin downloads it, saves it to Downloads and
 *                 opens it in the phone's PDF viewer — Chrome is never involved
 *   older app     no plugin in its APK (OTA runs this code on old APKs): the previous in-place
 *                 navigation to the route, on the API's origin
 *
 *   View          web only, in place, with ?view=1 (an inline disposition). The app has no PDF
 *                 viewer, so View would only download again: canView() is false there.
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

type CertificateLink = { url: string; filename: string };
type CertificateFilePlugin = { save: (opts: CertificateLink) => Promise<unknown> };

const CertificateFile = registerPlugin<CertificateFilePlugin>('CertificateFile');

export type DownloadEnv = {
  native: boolean;
  plugin: CertificateFilePlugin | null;
  getLink: (downloadUrl: string) => Promise<CertificateLink>;
  follow: (href: string, newTab: boolean) => void;
  resolve: (downloadUrl: string) => string;
};

/** The download route is root-relative ('/api/portal/...'); the api client already carries that base. */
async function getLink(downloadUrl: string): Promise<CertificateLink> {
  const path = downloadUrl.replace(/^\/api\/portal/, '');
  const { data } = await api.get(path, { params: { format: 'json' } });
  if (!data?.url) throw new Error('no certificate link');
  return { url: data.url, filename: data.filename || 'NIETE-certificate.pdf' };
}

function defaultEnv(): DownloadEnv {
  const native = isNativeApp();
  return {
    native,
    plugin: native && Capacitor.isPluginAvailable('CertificateFile') ? CertificateFile : null,
    getLink,
    follow,
    resolve: resolveDownloadUrl,
  };
}

export type DownloadOutcome = 'saved' | 'failed';

/** Save a certificate without leaving the portal. Never throws. */
export async function downloadCertificate(downloadUrl: string, env: DownloadEnv = defaultEnv()): Promise<DownloadOutcome> {
  if (env.native && !env.plugin) {
    env.follow(env.resolve(downloadUrl), false);
    return 'saved';
  }
  try {
    const link = await env.getLink(downloadUrl);
    if (env.plugin) await env.plugin.save({ url: link.url, filename: link.filename });
    else env.follow(link.url, false);
    return 'saved';
  } catch {
    return 'failed';
  }
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
