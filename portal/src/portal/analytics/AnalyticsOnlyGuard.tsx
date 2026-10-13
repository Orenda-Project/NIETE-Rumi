import { useContext, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../hooks/authContext';
import { redirectFor } from '../lib/homeRoute';

/**
 * bd-s6qbts.3 — the ONE guard around the app's whole route table (App.tsx), applying lib/homeRoute's rule:
 *   - an analytics-only account that opens any other portal page goes to the schools analytics page;
 *   - anyone else who opens the analytics page goes to their own home.
 *
 * It renders the redirect INSTEAD of the routes, so the page she was turned away from never mounts (no flash of a
 * teacher screen, none of its requests).
 *
 * It reads the signed-in user the app already holds (AuthProvider) and never asks for it: useAuth() would make every
 * page — the privacy policy, the sign-in form — read the session, and a 401 there sends a signed-out visitor to the
 * login page. Every signed-in page asks for the user itself; the moment it is known, this decides.
 */
const AnalyticsOnlyGuard = ({ children }: { children: ReactNode }) => {
  const shared = useContext(AuthContext);
  const { pathname } = useLocation();
  const to = shared && !shared.loading ? redirectFor(shared.user, pathname) : null;
  if (to) return <Navigate to={to} replace />;
  return <>{children}</>;
};

export default AnalyticsOnlyGuard;
