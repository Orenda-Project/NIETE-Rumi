import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNativeApp, isNativePluginAvailable } from '@/lib/runtime';
// @ts-expect-error - CommonJS module shared with the Jest test suite
import { OVERLAY_SELECTOR, resolveBackAction } from '@/lib/back-button.cjs';

/**
 * Android hardware back key: close an open dialog, go back a page, or leave
 * the app from a home page (rule: src/lib/back-button.cjs).
 *
 * @capacitor/app's back handler is OFF in the APK (capacitor.config.ts) and
 * switched on here at runtime, so this behaviour ships over the air and a
 * portal rolled back to a bundle without this component leaves the back key at
 * Android's default — never stuck on a page.
 *
 * "Leave" is minimizeApp (move to background), as Android's own back does from
 * a root screen on current versions: the session and page survive, and she
 * returns to whatever she came from, usually WhatsApp.
 *
 * A no-op in the browser, and on any app build without the plugin: under OTA
 * this bundle also runs on older APKs, where the plugin does not exist.
 */
const BackButtonHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Refs, so the listener is registered once rather than on every route change.
  const navigateRef = useRef(navigate);
  const pathRef = useRef(location.pathname);
  navigateRef.current = navigate;
  pathRef.current = location.pathname;

  useEffect(() => {
    if (!isNativeApp() || !isNativePluginAvailable('App')) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;

    import('@capacitor/app')
      .then(async ({ App }) => {
        const handle = await App.addListener('backButton', ({ canGoBack }) => {
          const action = resolveBackAction({
            path: pathRef.current,
            canGoBack,
            overlayOpen: Boolean(document.querySelector(OVERLAY_SELECTOR)),
          });
          if (action === 'close-overlay') {
            (document.activeElement ?? document.body).dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
            );
          } else if (action === 'history-back') {
            navigateRef.current(-1);
          } else {
            App.minimizeApp().catch(() => {});
          }
        });
        // Listener first, then the switch: once the handler is on, there is
        // always someone to answer it.
        await App.toggleBackButtonHandler({ enabled: true }).catch(() => {});
        const off = () => {
          App.toggleBackButtonHandler({ enabled: false }).catch(() => {});
          handle.remove();
        };
        if (cancelled) off();
        else teardown = off;
      })
      .catch(() => {
        // The plugin failed to load: the back key keeps Android's default.
      });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  return null;
};

export default BackButtonHandler;
