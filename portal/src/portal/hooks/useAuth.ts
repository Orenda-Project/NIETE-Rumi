import { useContext, useState, useEffect, useRef, useCallback } from 'react';
import { AuthContext } from './authContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth, portal } from '../services/api';
import type { User } from '../types/portal';
import { clearShellHint } from '../lib/shellHint';

/**
 * bd-5rz1v.6.6 — PortalLayout PROVIDES the user it loaded. Everything inside the
 * layout (the navigation above all) reads that user instead of fetching its own:
 * a second, independent fetch started with no user, so for a moment a leader
 * got the teacher navigation, and every page read /dashboard twice.
 *
 * bd-fxk3t8 — and the app PROVIDES it above every route (AuthProvider), so it is
 * read once per visit instead of once per page. A provider that can be asked
 * (`request`) is asked here: the first page that needs the user starts the read,
 * a later page may start a background re-read once it is stale.
 */
export const useAuth = () => {
  const shared = useContext(AuthContext);
  // Called on every render either way (the rules of hooks); it fetches only
  // when there is no provider above it.
  const own = useOwnAuth(!shared);
  const request = (shared as { request?: () => void } | null)?.request;
  // On every page, including one that reuses the same component (two routes, one page).
  const { pathname } = useLocation();
  useEffect(() => {
    if (request) request();
  }, [request, pathname]);
  return (shared as ReturnType<typeof useOwnAuth> | null) || own;
};

const sameUser = (a: User | null, b: User | null) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * @param active          read the user (on mount, or as soon as it turns true)
 * @param initialLoading  what `loading` says before the first read (the app-level
 *                        provider starts "loading": nobody knows yet)
 */
export function useOwnAuth(active: boolean, initialLoading: boolean = active) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(initialLoading);
  const [fetchedAt, setFetchedAt] = useState(0);
  const started = useRef(false);
  const navigate = useNavigate();

  /**
   * `silent`: a background re-read — `loading` stays as it is, and a failed read
   * keeps the user we have (a network blip is not a sign-out; a real 401 is
   * handled by the API client, which sends her to the login page).
   */
  const checkAuth = useCallback(async (silent = false) => {
    try {
      // Try to get dashboard data - if successful, user is authenticated
      const data = await portal.getDashboard();
      // The same user again keeps the same object, so nothing re-renders for it.
      setUser((prev) => (sameUser(prev, data.user) ? prev : data.user));
      setFetchedAt(Date.now());
    } catch (error) {
      if (!silent) {
        setUser(null);
        // No session: the next cold start shows the sign-in outline, not the app's frame.
        clearShellHint();
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !started.current) {
      started.current = true;
      checkAuth();
    }
  }, [active, checkAuth]);

  const login = async (phoneNumber: string, password: string) => {
    try {
      const response = await auth.login(phoneNumber, password);
      if (response.success) {
        await checkAuth(); // Refresh user data
        // bd-2434: hand the role back so the caller can route a leader straight
        // to My Patch instead of flashing the teacher dashboard.
        return { success: true, user: response.user };
      }
      return { success: false, error: response.error || 'Login failed' };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Login failed. Please try again.'
      };
    }
  };

  const logout = async () => {
    try {
      await auth.logout();
      setUser(null);
      clearShellHint();
      navigate('/portal/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const setupPortal = async (token: string, password: string) => {
    try {
      const response = await auth.setup(token, password);
      if (response.success) {
        await checkAuth(); // Refresh user data
        return { success: true };
      }
      return { success: false, error: response.error || 'Setup failed' };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'Setup failed. Please try again.'
      };
    }
  };

  return {
    user,
    loading,
    login,
    logout,
    setupPortal,
    checkAuth,
    fetchedAt,
  };
}
