import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getAppFunnel, type AppFunnel } from '../lib/appFunnel';

/**
 * bd-4r3rei — reports each page she opens, and when she leaves it, to the app funnel (lib/appFunnel.ts). Renders
 * nothing and changes nothing on any screen. Sits inside the router, above the routes, like AppLinkListener.
 *
 * Leaving: `visibilitychange` (WhatsApp's in-app browser fires it when she switches app or the view closes) and
 * `pagehide` (a real unload). `pageshow` with `persisted` is a page restored from the back-forward cache — she is back.
 */
const AppFunnelTracker = () => {
  const { pathname } = useLocation();
  const funnelRef = useRef<AppFunnel | null>(null);
  if (!funnelRef.current) {
    try { funnelRef.current = getAppFunnel(); } catch { funnelRef.current = null; }
  }

  useEffect(() => {
    try { funnelRef.current?.view(pathname); } catch { /* never */ }
  }, [pathname]);

  useEffect(() => {
    const funnel = funnelRef.current;
    if (!funnel) return undefined;
    const onVisibility = () => {
      try {
        if (document.visibilityState === 'hidden') funnel.hidden('hidden');
        else funnel.visible();
      } catch { /* never */ }
    };
    const onPageHide = () => { try { funnel.hidden('pagehide'); } catch { /* never */ } };
    const onPageShow = (e: Event) => { try { if ((e as PageTransitionEvent).persisted) funnel.visible(); } catch { /* never */ } };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  return null;
};

export default AppFunnelTracker;
