import { ReactNode, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../hooks/authContext';
import { useRecordingSession } from '../lib/recordingSession';
import { useNewUi } from '../lib/useNewUi';
import PortalNavigation from './PortalNavigation';
import RecordingBar from './RecordingBar';

interface PortalLayoutProps {
  children: ReactNode;
  /** Hide the navigation (bd-5rz1v: while a lesson is recorded or sent). */
  bare?: boolean;
  /**
   * What to show while the session loads, inside the page's own frame, instead
   * of the full-screen spinner (bd-3wb0s: My account holds its layout with a
   * skeleton). The desktop nav's 64px is reserved so nothing moves when the
   * real page replaces it. Optional: every other page keeps the spinner.
   */
  loadingFallback?: ReactNode;
  /**
   * bd-5rz1v.17 — a new-UI page that draws its own heading (MainHeading / InnerBar, which bleed
   * to the screen's edges): the main area has no side or top padding, the page is the new UI's
   * light surface, and the phone's slim top strip goes (the band carries her avatar).
   */
  ownHeading?: boolean;
}

const PortalLayout = ({ children, bare = false, loadingFallback, ownHeading = false }: PortalLayoutProps) => {
  const auth = useAuth();
  const { user, loading } = auth;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // bd-5rz1v.10 — a lesson still recording shows its bar on every page but its own.
  const session = useRecordingSession();
  const showBar = !!session?.active && session.returnTo !== pathname;
  // bd-5rz1v.12 — the new UI's indigo bar is taller than the old one; only then
  // does the page (and the recording bar) need more room. Off: as before.
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user) === true;

  useEffect(() => {
    if (!loading && !user) {
      navigate('/portal/login');
    }
  }, [user, loading, navigate]);

  if (loading && loadingFallback) {
    return (
      <div className="min-h-screen bg-secondary" aria-busy="true">
        {!bare && <div className="hidden md:block h-16 bg-primary" aria-hidden="true" />}
        <main className={bare ? 'px-4 md:px-6 lg:px-8 pt-4 pb-8' : 'px-4 md:px-6 lg:px-8 pt-4 pb-20 md:pb-8'}>
          {loadingFallback}
        </main>
      </div>
    );
  }

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
  // must not take her away — a lesson being sent.
  //
  // The recording bar (bd-5rz1v.10) sits above the bottom menu on a phone, so
  // the page's own bottom padding grows by the bar's height to keep the last
  // thing on the page reachable; on a desktop it floats in a corner instead.
  const pad = bare
    ? (showBar ? 'pb-24 md:pb-24' : 'pb-8')
    : newUi
      ? (showBar ? 'pb-[calc(176px+env(safe-area-inset-bottom))] md:pb-24' : 'pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-8')
      : (showBar ? 'pb-40 md:pb-24' : 'pb-20 md:pb-8');
  return (
    // The loaded user, to everything inside: the navigation never starts from "no user".
    <AuthContext.Provider value={auth}>
    <div className={ownHeading ? 'min-h-screen bg-nu-surface' : 'min-h-screen bg-secondary'}>
      {!bare && <PortalNavigation hideStrip={ownHeading} />}
      {/* Issue #22: Added consistent padding for content */}
      <main className={ownHeading ? pad : `px-4 md:px-6 lg:px-8 pt-4 ${pad}`}>
        {children}
      </main>
      {showBar && session && <RecordingBar session={session} aboveMenu={!bare} newMenu={newUi} />}
    </div>
    </AuthContext.Provider>
  );
};

export default PortalLayout;
