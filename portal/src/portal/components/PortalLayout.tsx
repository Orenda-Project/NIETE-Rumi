import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import PortalNavigation from './PortalNavigation';

interface PortalLayoutProps {
  children: ReactNode;
  /** Hide the navigation (bd-5rz1v: while a lesson is recorded or sent). */
  bare?: boolean;
}

const PortalLayout = ({ children, bare = false }: PortalLayoutProps) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/portal/login');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // `bare` (bd-5rz1v): no navigation at all, for a screen where one stray tap
  // must not take her away — a lesson being recorded, or being sent.
  return (
    <div className="min-h-screen bg-secondary">
      {!bare && <PortalNavigation />}
      {/* Issue #22: Added consistent padding for content */}
      <main className={bare ? 'px-4 md:px-6 lg:px-8 pt-4 pb-8' : 'px-4 md:px-6 lg:px-8 pt-4 pb-20 md:pb-8'}>
        {children}
      </main>
    </div>
  );
};

export default PortalLayout;
