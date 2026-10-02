import { useContext, useState, useEffect } from 'react';
import { AuthContext } from './authContext';
import { useNavigate } from 'react-router-dom';
import { auth, portal } from '../services/api';
import type { User } from '../types/portal';

/**
 * bd-5rz1v.6.6 — PortalLayout PROVIDES the user it loaded. Everything inside the
 * layout (the navigation above all) reads that user instead of fetching its own:
 * a second, independent fetch started with no user, so for a moment a leader
 * got the teacher navigation, and every page read /dashboard twice.
 */
export const useAuth = () => {
  const shared = useContext(AuthContext);
  // Called on every render either way (the rules of hooks); it fetches only
  // when there is no provider above it.
  const own = useOwnAuth(!shared);
  return (shared as ReturnType<typeof useOwnAuth> | null) || own;
};

function useOwnAuth(fetchOnMount: boolean) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(fetchOnMount);
  const navigate = useNavigate();

  useEffect(() => {
    if (fetchOnMount) checkAuth();
    // Mount-only, as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuth = async () => {
    try {
      // Try to get dashboard data - if successful, user is authenticated
      const data = await portal.getDashboard();
      setUser(data.user);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

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
    checkAuth
  };
}
