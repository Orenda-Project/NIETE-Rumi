import type { CapacitorConfig } from '@capacitor/cli';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveOtaUrl } = require('./src/lib/app-target.cjs');

/**
 * Remote-first OTA origin, or undefined to use the assets bundled in the APK.
 *
 * OPT-IN, not default: `NIETE_OTA=1` turns it on for a build. A release built
 * without it behaves exactly as today, so this can be rolled out one build at
 * a time and switched off by rebuilding rather than by an emergency patch.
 *
 * Reads VITE_API_BASE_URL — the same value the web build uses for its API — so
 * there is one configured host, not two that can disagree. `.env.app` supplies
 * it locally; CI supplies it as a secret.
 */
const otaUrl: string | null = process.env.NIETE_OTA === '1'
  ? resolveOtaUrl({ isNative: true, apiBaseUrl: process.env.VITE_API_BASE_URL })
  : null;

/**
 * NIETE portal Android app.
 *
 * appId MUST stay `pk.edu.niete` — this build replaces the existing NIETE
 * Play Store listing, and Play identifies an app by package name permanently.
 * A different id would create a second, unrelated listing that cannot
 * replace or upgrade the existing one.
 *
 * `hostname: 'localhost'` (matching the existing NIETE app) is why the portal
 * needs the app-target fix: hostname-sniffing to decide "am I the portal?"
 * is false in the WebView.
 *
 * `loggingBehavior: 'production'` is deliberate — Capacitor's Android bridge
 * can exhaust memory on unbounded console output. That caused a real
 * production incident on the existing app.
 */
const config: CapacitorConfig = {
  appId: 'pk.edu.niete',
  appName: 'NIETE',
  webDir: 'dist',
  loggingBehavior: 'production',
  android: {
    // Release signing comes from environment/CI secrets, never committed.
    // See android/keystore.properties.template.
    buildOptions: {
      keystorePath: process.env.NIETE_KEYSTORE_PATH,
      keystorePassword: process.env.NIETE_KEYSTORE_PASSWORD,
      keystoreAlias: process.env.NIETE_KEY_ALIAS,
      keystoreAliasPassword: process.env.NIETE_KEY_PASSWORD,
      releaseType: 'AAB',
    },
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    // bd-2553 — remote-first OTA.
    //
    // When NIETE_OTA=1 the WebView loads the SPA from the live portal instead
    // of the copy bundled in the APK, so a web deploy updates every installed
    // app on next launch. That is the whole point: this app is a pure WebView
    // wrap with no native plugins, so the web bundle IS the product, and
    // routing a one-line fix through a signed upload + Play review is what let
    // bd-2551's white screen stay live long enough to need a downtime notice.
    //
    // The origin is derived from VITE_API_BASE_URL (see resolveOtaUrl in
    // src/lib/app-target.cjs), so the host serving the code can never drift
    // from the host serving the data. If it can't be derived, this stays
    // undefined and Capacitor falls back to the bundled assets — a known-good
    // floor rather than a blank shell.
    //
    // The bundled build still ships and still must be correct: it is what runs
    // on first launch and whenever the server is unreachable.
    ...(otaUrl ? { url: otaUrl } : {}),
  },
};

export default config;
