import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { isLeader } from '../lib/leaderRole';
import PortalLogin from './PortalLogin';
import { FrameSkeleton, LoginSkeleton } from '../components/Skeleton';
import { readShellHint } from '../lib/shellHint';

/**
 * What "/" renders for the portal audience (bd-2394).
 *
 * The Android app always cold-boots to "/" — the Capacitor WebView serves the
 * bundle from https://localhost with no path — so "/" was every launch's entry
 * point. It used to render PortalLogin unconditionally, which meant a teacher
 * whose session was perfectly valid got the login form after every force-close
 * and reasonably concluded the app had logged them out.
 *
 * The session was never at fault: the cookie is persistent (7-day Max-Age,
 * Secure, SameSite=None), survives the process kill thanks to the pause-time
 * CookieManager.flush() in MainActivity (bd-2402), and /api/portal/dashboard
 * answers 200 on that very first cold-boot request. Only the routing ignored it.
 *
 * So "/" now decides from the session rather than from the URL. useAuth's
 * checkAuth() already probes the API on mount, which is the same call the app
 * was making and discarding.
 *
 * Waiting for `loading` matters as much as the redirect: rendering the form
 * while the probe is in flight would flash a login screen at an authenticated
 * user on every launch — the same wrong impression, just briefer.
 *
 * Web is unaffected. This is only reachable where the portal owns "/" (a
 * `portal.` subdomain or the native app); the marketing site still renders
 * <Index /> — see App.tsx.
 */
const PortalRoot = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    // bd-2434 parity: leaders belong on My Patch, not the teacher dashboard.
    navigate(isLeader(user) ? '/portal/leader' : '/portal/dashboard', { replace: true });
  }, [user, loading, navigate]);

  // An outline until the session is known (bd-fxk3t8: it was a white screen on every
  // app launch) — the app's frame if this device was signed in last time, else the
  // sign-in card. Then either the redirect above fires or there is genuinely no
  // session and the form is the right answer.
  if (loading || user) {
    const hint = readShellHint();
    return hint ? <FrameSkeleton variant={hint} /> : <LoginSkeleton />;
  }

  return <PortalLogin />;
};

export default PortalRoot;
