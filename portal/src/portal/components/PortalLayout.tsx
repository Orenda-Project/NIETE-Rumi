import { ReactNode, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthContext } from '../hooks/authContext';
import { useRecordingSession } from '../lib/recordingSession';
import { RecordingBarShownContext } from '../lib/recordingBarShown';
import { useNewUi } from '../lib/useNewUi';
import { useCoachV2, isCoachV2For } from '../coach/useCoachV2';
import { useTeacherV2, isTeacherV2For } from '../teacher/useTeacherV2';
import { NoticeHost } from '../teacher/notices/NoticeHost';
import PortalNavigation from './PortalNavigation';
import RecordingBar from './RecordingBar';
import { FrameSkeleton, TabBarSkeleton, TopBarSkeleton } from './Skeleton';
import { readShellHint, writeShellHint } from '../lib/shellHint';
import {
  areaHome, isAreaPath, isLinkSession, linkArea, rememberLinkSession, LINK_EXPIRED_PAGE,
} from '../lib/linkSession';

interface PortalLayoutProps {
  children: ReactNode;
  /** Hide the navigation (bd-5rz1v: while a lesson is recorded or sent). */
  bare?: boolean;
  /**
   * What to show while the session loads, inside the page's own frame (bd-3wb0s: My
   * account holds its layout with a skeleton). The desktop nav's 64px is reserved so
   * nothing moves when the real page replaces it. Optional: without it the frame holds
   * placeholder blocks (bd-fxk3t8 — there is no full-screen spinner any more).
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
  // bd-o15qnr — a coach on v2 keeps the live look even with the new UI on (v2 wins).
  const coachV2 = isCoachV2For(user, useCoachV2(user?.phoneNumber || null, !loading && !!user));
  // bd-fmf24g.1 — a teacher on v2 gets the v2 frame and menu (v2 wins over the new UI too).
  const teacherFlag = useTeacherV2(user?.phoneNumber || null, !loading && !!user);
  const teacherV2 = isTeacherV2For(user, teacherFlag);
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user) === true && !coachV2 && !teacherV2;
  // The frame this device showed last — what to draw while the user or the menu is unknown.
  const hint = readShellHint() ?? 'classic';
  // bd-fxk3t8 — on a device that last showed the v2 frame, a teacher's menu is not drawn
  // until her v2 flag is read (remembered per user, so only on the first page of a visit):
  // placeholder bars hold its place. Drawing the classic menu first was a flash of the wrong
  // one. Every other device draws the classic menu at once, exactly as before.
  const teacherUser = isTeacherV2For(user, true);
  const menuPending = teacherUser && teacherFlag === null && hint === 'teacher';
  const frameKnown = !!user && (!teacherUser || teacherFlag !== null);

  // A session from a template's link (WhatsApp's own browser) can read its own area only
  // (training, lesson plans): no navigation, every other page goes to the area's home, and
  // once it runs out she goes back to the link page rather than a password login
  // (lib/linkSession.ts). An area this app does not know shows nothing.
  const area = linkArea(user);
  const linkOnly = !!area;
  const home = area ? areaHome(area) : null;
  const offArea = !!area && !isAreaPath(area, pathname);

  useEffect(() => {
    if (!loading && user) rememberLinkSession(linkOnly);
  }, [user, loading, linkOnly]);

  // bd-fxk3t8 — remembered for the next cold start: index.html's static shell draws this frame.
  useEffect(() => {
    if (frameKnown) writeShellHint(teacherV2 ? 'teacher' : 'classic');
  }, [frameKnown, teacherV2]);

  useEffect(() => {
    if (!offArea) return;
    if (home) navigate(home, { replace: true });
    else window.location.replace(LINK_EXPIRED_PAGE);
  }, [offArea, home, navigate]);

  useEffect(() => {
    if (!loading && !user) {
      if (isLinkSession()) window.location.replace(LINK_EXPIRED_PAGE);
      else navigate('/portal/login');
    }
  }, [user, loading, navigate]);

  // bd-fxk3t8 — the first page of a visit, while the user is read: the app's frame with
  // placeholder blocks (or the page's own), never a full-screen spinner. Under the app's
  // AuthProvider every later page already has her and never comes here.
  if (loading) {
    return <FrameSkeleton variant={hint} bare={bare}>{loadingFallback}</FrameSkeleton>;
  }

  if (!user || offArea) return null;

  // `bare` (bd-5rz1v): no navigation at all, for a screen where one stray tap
  // must not take her away — a lesson being sent.
  //
  // The recording bar (bd-5rz1v.10) sits above the bottom menu on a phone, so
  // the page's own bottom padding grows by the bar's height to keep the last
  // thing on the page reachable. On a desktop the old menu's bar floats in a
  // corner; the new menu's docks in an 81px strip on the bottom edge
  // (bd-5rz1v.26.4), and md:pb-24 (96px) keeps the page's end above it.
  const noNav = bare || linkOnly;
  // While her menu is pending (a v2 device), the page is already padded for the v2 frame.
  // bd-4404s7.2 — a coach on v2 stands in the same frame (the kit's bar, 78px + the safe area).
  const v2Frame = teacherV2 || coachV2 || menuPending;
  const pad = noNav
    ? (showBar ? 'pb-24 md:pb-24' : 'pb-8')
    // bd-fmf24g.1 — the v2 bottom bar is 78px + the safe area (canvas: 6 + 58 + 14).
    : v2Frame
      ? (showBar ? 'pb-[calc(168px+env(safe-area-inset-bottom))] md:pb-24' : 'pb-[calc(88px+env(safe-area-inset-bottom))] md:pb-8')
    : newUi
      ? (showBar ? 'pb-[calc(176px+env(safe-area-inset-bottom))] md:pb-24' : 'pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-8')
      : (showBar ? 'pb-40 md:pb-24' : 'pb-20 md:pb-8');
  return (
    // The loaded user, to everything inside: the navigation never starts from "no user".
    <AuthContext.Provider value={auth}>
    <div className={v2Frame ? 'min-h-screen bg-[#f3f4f6]' : ownHeading ? 'min-h-screen bg-nu-surface' : 'min-h-screen bg-secondary'}>
      {!noNav && (menuPending
        ? <><TopBarSkeleton variant={hint} /><TabBarSkeleton variant={hint} /></>
        : <PortalNavigation hideStrip={ownHeading} />)}
      {/* Issue #22: Added consistent padding for content */}
      <main className={ownHeading ? pad : `px-4 md:px-6 lg:px-8 pt-4 ${pad}`}>
        {/* bd-5rz1v.14 — a new-UI page's bottom action stands above the bar while it shows. */}
        <RecordingBarShownContext.Provider value={showBar && !noNav}>
          {children}
        </RecordingBarShownContext.Provider>
        {/* bd-fmf24g.15 — what is being made, and "ready", on every teacher v2 screen (and only those). It stays
            mounted-or-not with the frame, but the tracker behind it is a module, so a page change does not
            restart anything. */}
        {teacherV2 && !menuPending && user.phoneNumber && (
          <NoticeHost userKey={user.phoneNumber} bare={noNav} aboveBar={showBar} />
        )}
      </main>
      {showBar && session && <RecordingBar session={session} aboveMenu={!noNav} newMenu={newUi} />}
    </div>
    </AuthContext.Provider>
  );
};

export default PortalLayout;
