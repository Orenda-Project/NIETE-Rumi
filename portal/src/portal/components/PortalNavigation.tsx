import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Library, GraduationCap, MessageSquare, TrendingUp, LogOut, Users, CalendarDays, MoreHorizontal, School, ClipboardList, BookOpen, CircleUserRound, ChevronRight, Eye } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '../hooks/useAuth';
import { isLeader, resolveRole } from '../lib/leaderRole';
import { useLogoutGuard } from '../lib/recordingSession';
import { useNewUi } from '../lib/useNewUi';
import NewUiNavigation from '../newui/NewUiNavigation';
import { useCoachV2, isCoachV2For } from '../coach/useCoachV2';
import { cn } from '@/lib/utils';
import nieteLogo from '@/assets/niete-logo.png';

/** bd-3wb0s — My account: name, school, privacy policy, account deletion, Logout. */
const ACCOUNT_PATH = '/portal/account';

/**
 * hideStrip (bd-5rz1v.17): the page draws its own heading band with her avatar in it, so the new
 * UI's slim top strip is not shown. No effect on the old navigation.
 */
const PortalNavigation = ({ hideStrip = false }: { hideStrip?: boolean } = {}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const { logout, user } = useAuth();
  // bd-5rz1v.10 — Logout would end a lesson still recording, so it asks first then.
  const guardedLogout = useLogoutGuard(logout);
  // bd-5rz1v.12 — the new UI's indigo menu bar, only while portal_new_ui is on
  // for her. Off, loading or unreadable: the markup below, unchanged.
  const newUiOn = useNewUi(user?.phoneNumber || null) === true;
  // bd-o15qnr — the coach app v2, for a coach with portal_coach_v2 only. It keeps
  // the live look below (white bottom bar, green active item) with its own
  // items, and it wins over the new UI for a coach. Off, loading, unreadable,
  // or not a coach: the markup below, unchanged.
  const coachV2 = isCoachV2For(user, useCoachV2(user?.phoneNumber || null));
  const currentPath = location.pathname;

  // bd-2434 (Leader Portal): the school-leader family gets the leader nav
  // (My Patch / Teachers); teachers keep today's nav unchanged. The NIETE logo
  // + wordmark below are identical for both. Leader-family only.
  const leaderNav = [
    { title: 'My Patch', path: '/portal/leader', icon: Home },
    { title: 'Teachers', path: '/portal/leader/teachers', icon: Users },
    // bd-2455 — schedule + debriefs + completed observations.
    { title: 'Observations', path: '/portal/leader/observations', icon: CalendarDays },
    // bd-60160 — a coach TAKES training too, she does not only supervise it.
    //
    // The leader family never had this entry, so when I-SAPS was assigned to
    // 89 people on production and 88 of them were coaches, the training was
    // unreachable in the portal for all 88: assigned, visible to the API, and
    // with no link anywhere in the UI. The gate was never a permission — the
    // training routes check the session and not the role — it was a missing
    // nav item.
    { title: 'Training', path: '/portal/training', icon: GraduationCap },
  ];

  // bd-60117 — Analytics, for PRINCIPALS only. A principal holds exactly one
  // school, so "your school's numbers" is a well-defined question for her and
  // for nobody else in the leader family: an AEO, supervisor or coach covers
  // many schools (85 of 400 assigned schools have more than one coach), so the
  // same tab would show them one school's data labelled as theirs. The other
  // four keep the nav they have; the endpoint 403s them regardless of the nav.
  //
  // Lessons joins Analytics here: a principal-gated route that existed with
  // no nav entry was reachable only by an in-page link, so a principal who
  // landed anywhere else had no way to it — a route nobody can find is not
  // shipped. Attendance used to be a third; it now lives inside Analytics, on
  // its Attendance tab (operator, 2026-09-30).
  const isPrincipal = resolveRole(user) === 'principal';
  if (isPrincipal) {
    leaderNav.push(
      { title: 'Analytics', path: '/portal/leader/school-analytics', icon: TrendingUp },
      { title: 'Lessons', path: '/portal/leader/lessons', icon: BookOpen },
    );
  }
  const teacherNav = [
    { title: 'Dashboard', path: '/portal/dashboard', icon: Home },
    { title: 'Lesson Plans', path: '/portal/curriculum', icon: Library },
    // bd-4n7p4 — the Assessment Generator was a tab of the Curriculum page; it is its own item
    // and page now. On a phone it lands under Other (not in MOBILE_PRIMARY).
    { title: 'Assessment Generator', path: '/portal/assessment', icon: ClipboardList },
    { title: 'Training', path: '/portal/training', icon: GraduationCap },
    { title: 'My Classes', path: '/portal/classes', icon: School },
    // bd-60078 — "My Plans" removed. It listed a teacher's own Gamma-generated
    // lesson plans and presentations, and custom generation is off, so the tab
    // could only ever show her older work with no way to make more. The
    // ready-made catalogue lives under Lesson Plans (the menu item formerly named Curriculum), which stays.
    { title: 'Coaching', path: '/portal/coaching', icon: MessageSquare },
    { title: 'Analytics', path: '/portal/coaching/analytics', icon: TrendingUp },
  ];

  // bd-o15qnr — v2: Home · Schedule · Observe · Schools on the bar; Training
  // (bd-60160: a coach must keep reaching it) in Other.
  const coachNav = [
    { title: 'Home', path: '/portal/coach', icon: Home },
    { title: 'Schedule', path: '/portal/coach/scheduling', icon: CalendarDays },
    { title: 'Observe', path: '/portal/coach/observe', icon: Eye },
    { title: 'Schools', path: '/portal/coach/people', icon: School },
    { title: 'Training', path: '/portal/training', icon: GraduationCap },
  ];

  const navItems = coachV2 ? coachNav : (isLeader(user) ? leaderNav : teacherNav);

  // bd-2466 — the mobile bar rendered every nav item plus Logout in one flex
  // row: seven cells for teachers, each ~52px wide on a 360px screen, so the
  // labels cropped. Keep the four the operator named as primary and put the
  // rest behind a tray. Desktop is unaffected — it has the width.
  const MOBILE_PRIMARY = coachV2
    ? ['Home', 'Schedule', 'Observe', 'Schools']
    : ['Dashboard', 'Lesson Plans', 'Training', 'Coaching'];
  const primaryNav = navItems.filter((i) => MOBILE_PRIMARY.includes(i.title));
  // Anything not named primary overflows — including leader nav, whose titles
  // don't appear in the list above, so it degrades to "all in the tray" rather
  // than silently dropping items.
  const overflowNav = navItems.filter((i) => !MOBILE_PRIMARY.includes(i.title));
  // Fall back to the first four when nothing matched, so a future rename can
  // never leave the bar empty.
  const mobileNav = primaryNav.length > 0 ? primaryNav : navItems.slice(0, 4);
  const mobileOverflow = primaryNav.length > 0 ? overflowNav : navItems.slice(4);

  // bd-o15qnr — in v2 a feature stays active on every page inside it.
  const COACH_SECTIONS: Record<string, string[]> = {
    '/portal/coach/scheduling': ['/portal/coach/scheduling', '/portal/coach/schedule', '/portal/coach/team', '/portal/coach/new-visit'],
    '/portal/coach/observe': ['/portal/coach/observe', '/portal/coach/visit', '/portal/coach/reports'],
    '/portal/coach/people': ['/portal/coach/people', '/portal/coach/school', '/portal/coach/teacher'],
  };
  const isActive = (path: string) => (coachV2 && COACH_SECTIONS[path]
    ? COACH_SECTIONS[path].some((p) => currentPath === p || currentPath.startsWith(`${p}/`))
    : currentPath === path);

  if (newUiOn && !coachV2) {
    return (
      <NewUiNavigation
        leader={isLeader(user)}
        navItems={navItems}
        mobileNav={mobileNav}
        mobileOverflow={mobileOverflow}
        isActive={isActive}
        accountPath={ACCOUNT_PATH}
        firstName={user?.firstName}
        lastName={user?.lastName}
        schoolName={user?.schoolName}
        onLogout={guardedLogout}
        hideStrip={hideStrip}
      />
    );
  }

  return (
    <>
      {/* Desktop Navigation - Top */}
      <nav className="hidden md:block bg-primary text-primary-foreground border-b border-white/10">
        <div className="container mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <img
                src={nieteLogo}
                alt="NIETE logo"
                className="w-8 h-8 object-contain rounded"
              />
              <span className="font-semibold text-lg">NIETE</span>
            </div>

            <div className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    // One line per label: seven items (Lesson Plans, Assessment Generator)
                    // wrapped below 1366px at px-4. Tighter padding until 2xl, and the
                    // icons only from xl, keep the bar inside the screen on laptops.
                    "flex items-center gap-2 whitespace-nowrap px-2 2xl:px-4 py-2 text-sm xl:text-base rounded-md transition-colors",
                    isActive(item.path)
                      ? "bg-white/20 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  )}
                >
                  <item.icon className="hidden xl:block w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.title}</span>
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {/*
                bd-2558: the name shares the Logout button's vertical metrics
                (py-2) and the nav's opacity (white/70), so the header carries
                one type treatment rather than three. `truncate` + a max-width
                keep a long name from pushing the logout control sideways, and
                the fallback keeps the slot from collapsing before the profile
                resolves — an empty span left Logout floating with no sign of
                who was logged in.

                bd-3wb0s: the name is now also the way into My account (where
                the privacy policy and account deletion live), so it IS a
                control: a link with a user icon, a hover state, and the
                accessible name "My account".
              */}
              <Link
                to={ACCOUNT_PATH}
                data-testid="portal-user-name"
                aria-label="My account"
                title="My account"
                className={cn(
                  "flex items-center gap-2 px-2 py-2 text-sm font-medium max-w-[12rem] truncate rounded-md transition-colors hover:text-white hover:bg-white/10",
                  isActive(ACCOUNT_PATH) ? "bg-white/20 text-white" : "text-white/70"
                )}
              >
                <CircleUserRound className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{user?.firstName || "Signed in"}</span>
              </Link>
              <button
                onClick={guardedLogout}
                className="flex items-center gap-2 px-4 py-2 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation - Bottom (bd-2466) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border shadow-lg z-50">
        <div className="flex items-center justify-around h-16">
          {mobileNav.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-1 py-2 flex-1 min-w-0 transition-colors",
                isActive(item.path) ? "text-accent" : "text-muted-foreground"
              )}
            >
              <item.icon className={cn("w-5 h-5 shrink-0", isActive(item.path) && "text-accent")} />
              <span className="text-xs w-full truncate text-center">{item.title}</span>
            </Link>
          ))}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Other"
                data-testid="mobile-nav-more"
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-1 py-2 flex-1 min-w-0 transition-colors",
                  mobileOverflow.some((i) => isActive(i.path)) || isActive(ACCOUNT_PATH) ? "text-accent" : "text-muted-foreground"
                )}
              >
                <MoreHorizontal className="w-5 h-5 shrink-0" />
                <span className="text-xs w-full truncate text-center">Other</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-xl">
              <SheetHeader className="text-left">
                <SheetTitle>Other</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex flex-col">
                {mobileOverflow.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors",
                      isActive(item.path) ? "text-accent bg-accent/10" : "text-foreground hover:bg-muted"
                    )}
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </Link>
                ))}
                {/* bd-3wb0s — My account, for every role, right above Logout.
                    The privacy policy and account deletion live on that page. */}
                <Link
                  to={ACCOUNT_PATH}
                  onClick={() => setMoreOpen(false)}
                  data-testid="mobile-nav-account"
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-sm transition-colors",
                    isActive(ACCOUNT_PATH) ? "text-accent bg-accent/10" : "text-foreground hover:bg-muted"
                  )}
                >
                  <CircleUserRound className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="truncate">My account</span>
                  <ChevronRight className="ms-auto w-4 h-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); guardedLogout(); }}
                  data-testid="mobile-nav-logout"
                  className="flex items-center gap-3 rounded-md px-3 py-3 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  <LogOut className="w-5 h-5 shrink-0" />
                  <span>Logout</span>
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </>
  );
};

export default PortalNavigation;
