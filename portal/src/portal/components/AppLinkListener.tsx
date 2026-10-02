import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getPortalOrigin, isNativeApp, isNativePluginAvailable } from '@/lib/runtime';
// @ts-expect-error - CommonJS module shared with the Jest test suite
import { resolveAppLinkPath } from '@/lib/app-links.cjs';

/**
 * Android App Links: open a tapped portal link on its own page in the app.
 *
 * Capacitor boots the WebView at its start page even when a link launched the
 * app; @capacitor/app delivers the link as `appUrlOpen`. It holds that event
 * until a listener exists, so this one listener covers both a cold start (the
 * app was closed) and a warm one (it was in the background) — calling
 * getLaunchUrl() as well would navigate twice.
 *
 * A no-op in the browser, and on any app build without the plugin: under OTA
 * this bundle also runs on older APKs, where the plugin does not exist.
 *
 * Signed-out handling is the pages' own: a protected page sends her to login,
 * exactly as when she opens it in a browser.
 */
const AppLinkListener = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Refs, so the listener is registered once rather than on every route change.
  const navigateRef = useRef(navigate);
  const hereRef = useRef(location.pathname + location.search + location.hash);
  navigateRef.current = navigate;
  hereRef.current = location.pathname + location.search + location.hash;

  useEffect(() => {
    if (!isNativeApp() || !isNativePluginAvailable('App')) return;

    let cancelled = false;
    let remove: (() => void) | null = null;

    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appUrlOpen', ({ url }) => {
          const target = resolveAppLinkPath(url, { portalOrigin: getPortalOrigin() });
          if (!target || target === hereRef.current) return;
          // From the boot route, replace it: going "back" to "/" would only
          // bounce through the session check again.
          navigateRef.current(target, { replace: hereRef.current === '/' });
        })
      )
      .then((handle) => {
        if (cancelled) handle.remove();
        else remove = () => handle.remove();
      })
      .catch(() => {
        // The plugin failed to load: links open the start page, as before.
      });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
};

export default AppLinkListener;
