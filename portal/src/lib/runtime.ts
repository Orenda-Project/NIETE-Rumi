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
    // bd-2554: under OTA the native shell runs the WEB bundle (no
    // VITE_API_BASE_URL) but is served by the portal itself. The origin is how
    // resolveApiBaseUrl tells that case apart from a bundled app sitting on
    // https://localhost, where a relative path would hit no server.
    origin: typeof window !== 'undefined' ? window.location.origin : undefined,
  });
}
