/**
 * Runtime adapter: reads the environment (Capacitor, Vite env, location) and
 * feeds it to the pure decision functions in app-target.cjs.
 *
 * Keeping the environment reads here means the decision logic stays unit
 * testable without a DOM, and there is exactly one place that knows how to
 * detect "am I in the app".
 */
// @ts-expect-error - CommonJS module shared with the Jest test suite
import { resolveIsPortal, resolveApiBaseUrl } from './app-target.cjs';
// @ts-expect-error - CommonJS module shared with the Jest test suite
import { resolvePortalOrigin } from './app-links.cjs';

/**
 * True when running inside the Capacitor native shell.
 *
 * Detected via the global Capacitor injects rather than importing
 * @capacitor/core, so the web bundle carries no native dependency.
 */
export function isNativeApp(): boolean {
  const cap = (globalThis as any)?.Capacitor;
  if (!cap) return false;
  return typeof cap.isNativePlatform === 'function'
    ? cap.isNativePlatform()
    : Boolean(cap.isNative);
}

/**
 * Is a given native plugin compiled into THIS app build?
 *
 * Under OTA the newest web bundle also runs on older APKs, so web code must
 * never assume a plugin exists just because its own build added it.
 */
export function isNativePluginAvailable(name: string): boolean {
  const cap = (globalThis as { Capacitor?: { isPluginAvailable?: (plugin: string) => boolean } })
    .Capacitor;
  return typeof cap?.isPluginAvailable === 'function' && cap.isPluginAvailable(name) === true;
}

/** Should the portal render (vs the public marketing site)? */
export function isPortalTarget(): boolean {
  return resolveIsPortal({
    isNative: isNativeApp(),
    appTarget: import.meta.env.VITE_APP_TARGET,
    hostname: typeof window !== 'undefined' ? window.location.hostname : '',
  });
}

/** Base URL for the portal JSON API. */
export function getApiBaseUrl(): string {
  return resolveApiBaseUrl({
    isNative: isNativeApp(),
    isProd: import.meta.env.PROD,
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
    // bd-2559: import.meta.env.PROD is baked in from NODE_ENV at BUILD time,
    // and the staging service sets NODE_ENV=staging — so PROD was false there
    // and the bundle shipped a hardcoded http://localhost:4000 that no user
    // could reach. The page's own origin is the reliable signal for "am I
    // really running on a developer's machine".
    origin: typeof window !== 'undefined' ? window.location.origin : undefined,
  });
}

/**
 * The portal's own origin, used to accept only our links as app links.
 * Null (ignore every link) when it cannot be worked out — never a throw.
 */
export function getPortalOrigin(): string | null {
  try {
    return resolvePortalOrigin({
      apiBaseUrl: getApiBaseUrl(),
      pageHref: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  } catch {
    return null;
  }
}

/**
 * bd-fmf24g.30 — where is this page running? Decides what "Open in another app" does (ui/ShareActions).
 *
 *   native       the NIETE Android app (Capacitor). Its WebView user agent also carries "; wv)", so the app is checked
 *                FIRST and a WebView is never mistaken for WhatsApp's browser.
 *   android-iab  WhatsApp's in-app browser on Android: "WhatsApp" or "WA4A/" in the user agent, or a bare Android
 *                WebView ("; wv)") that is not our app.
 *   ios-iab      an iPhone/iPad web view that is not Safari or another browser: WKWebView leaves out the "Safari/" token.
 *   browser      anything else (Chrome, Safari, Samsung Internet, a desktop).
 */
export type BrowserEnv = 'native' | 'android-iab' | 'ios-iab' | 'browser';

export function classifyBrowser(userAgent: string | null | undefined, native: boolean): BrowserEnv {
  if (native) return 'native';
  const ua = String(userAgent || '');
  if (/Android/i.test(ua)) return /WhatsApp|WA4A\/|; wv\)/.test(ua) ? 'android-iab' : 'browser';
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
    return !otherBrowser && (/WhatsApp/.test(ua) || !/Safari\//.test(ua)) ? 'ios-iab' : 'browser';
  }
  return 'browser';
}

/** The environment this page is running in (see classifyBrowser). */
export function browserEnv(): BrowserEnv {
  return classifyBrowser(typeof navigator !== 'undefined' ? navigator.userAgent : '', isNativeApp());
}

/** True inside WhatsApp's (or another app's) in-app browser, where downloads, PDFs and printing often fail. */
export function isInAppBrowser(): boolean {
  const env = browserEnv();
  return env === 'android-iab' || env === 'ios-iab';
}
