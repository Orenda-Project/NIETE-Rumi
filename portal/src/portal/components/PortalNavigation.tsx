import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, BookOpen, Library, GraduationCap, MessageSquare, TrendingUp, LogOut, Users, CalendarDays, MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '../hooks/useAuth';
import { isLeader } from '../lib/leaderRole';
import { cn } from '@/lib/utils';
import nieteLogo from '@/assets/niete-logo.png';

const PortalNavigation = () => {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const { logout, user } = useAuth();
  const currentPath = location.pathname;

  // bd-2434 (Leader Portal): the school-leader family gets the leader nav
  // (My Patch / Teachers); teachers keep today's nav unchanged. The NIETE logo
  // + wordmark below are identical for both. Leader-family only.
  const leaderNav = [
    { title: 'My Patch', path: '/portal/leader', icon: Home },
    { title: 'Teachers', path: '/portal/leader/teachers', icon: Users },
    // bd-2455 — schedule + debriefs + completed observations.
    { title: 'Observations', path: '/portal/leader/observations', icon: CalendarDays },
  ];
  const teacherNav = [
    { title: 'Dashboard', path: '/portal/dashboard', icon: Home },
    { title: 'Curriculum', path: '/portal/curriculum', icon: Library },
    { title: 'Training', path: '/portal/training', icon: GraduationCap },
    { title: 'My Plans', path: '/portal/lesson-plans', icon: BookOpen },
    { title: 'Coaching', path: '/portal/coaching', icon: MessageSquare },
    { title: 'Analytics', path: '/portal/coaching/analytics', icon: TrendingUp },
  ];

  const navItems = isLeader(user) ? leaderNav : teacherNav;

  // bd-2466 — the mobile bar rendered every nav item plus Logout in one flex
  // row: seven cells for teachers, each ~52px wide on a 360px screen, so the
  // labels cropped. Keep the four the operator named as primary and put the
  // rest behind a tray. Desktop is unaffected — it has the width.
  const MOBILE_PRIMARY = ['Dashboard', 'Curriculum', 'Training', 'Coaching'];
  const primaryNav = navItems.filter((i) => MOBILE_PRIMARY.includes(i.title));
  // Anything not named primary overflows — including leader nav, whose titles
  // don't appear in the list above, so it degrades to "all in the tray" rather
  // than silently dropping items.
  const overflowNav = navItems.filter((i) => !MOBILE_PRIMARY.includes(i.title));
  // Fall back to the first four when nothing matched, so a future rename can
  // never leave the bar empty.
  const mobileNav = primaryNav.length > 0 ? primaryNav : navItems.slice(0, 4);
  const mobileOverflow = primaryNav.length > 0 ? overflowNav : navItems.slice(4);

  const isActive = (path: string) => currentPath === path;

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
                    "flex items-center gap-2 px-4 py-2 rounded-md transition-colors",
                    isActive(item.path)
                      ? "bg-white/20 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.title}</span>
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {/*
                bd-2558: the name shares the Logout button's vertical metrics
                (py-2) and the nav's opacity (white/70), so the header carries
                one type treatment rather than three. No hover state — it is a
                label, not a control, and giving it one would imply it is
                clickable. `truncate` + a max-width keep a long name from pushing
                the logout control sideways, and the fallback keeps the slot
                from collapsing before the profile resolves — an empty span
                left Logout floating with no sign of who was logged in.
              */}
              <span
                data-testid="portal-user-name"
                title={user?.firstName}
                className="px-2 py-2 text-sm font-medium text-white/70 max-w-[12rem] truncate"
              >
                {user?.firstName || "Signed in"}
              </span>
              <button
                onClick={logout}
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
                aria-label="More"
                data-testid="mobile-nav-more"
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-1 py-2 flex-1 min-w-0 transition-colors",
                  mobileOverflow.some((i) => isActive(i.path)) ? "text-accent" : "text-muted-foreground"
                )}
              >
                <MoreHorizontal className="w-5 h-5 shrink-0" />
                <span className="text-xs w-full truncate text-center">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-xl">
              <SheetHeader className="text-left">
                <SheetTitle>More</SheetTitle>
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
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); logout(); }}
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
