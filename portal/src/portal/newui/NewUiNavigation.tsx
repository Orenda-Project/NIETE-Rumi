import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, BookOpen, ChevronRight, CircleUserRound, House, LogOut, Mic, MoreHorizontal, Users, X } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import nieteLogo from '@/assets/niete-logo.png';

/**
 * bd-5rz1v.12 — the new UI's menu bar (Direction B, option 2: "indigo menu bar").
 * Rendered by PortalNavigation only while `portal_new_ui` is on for her; with the
 * flag off PortalNavigation returns its old markup untouched.
 *
 * Phone: an indigo bar at the bottom — four places and More, icon over one or two
 * words, every target at least 56px. The item she is on is white with its icon in
 * logo green, in a translucent pill; the others are a muted lilac-grey. More opens
 * the same sheet as before (the other items, My account, Logout), restyled as big
 * rows with neutral grey icons — a feature colour is only ever a page-heading icon.
 * Desktop: an indigo bar at the top with the NIETE mark, the same places, the
 * active one highlighted, then My account (her name) and Logout.
 *
 * Teachers' places are relabelled to the new words (Dashboard → Home,
 * Curriculum → Lessons) with the mockup's icons; the destinations do not move.
 * Leader roles keep their own items exactly — only the colours change.
 *
 * Labels are English literals, like the old nav's: the portal has no catalog
 * for its navigation (src/i18n covers the public landing page only), and in
 * Urdu the page turns RTL around them. Spacing is logical (start/end) only, so
 * the bars mirror themselves; DESIGN.md has the rules.
 */

export type NavItem = { title: string; path: string; icon: LucideIcon };

/** Teacher places in the new words. Keyed by PATH, so a destination can never change. */
const TEACHER_RELABEL: Record<string, { title: string; icon: LucideIcon }> = {
  '/portal/dashboard': { title: 'Home', icon: House },
  '/portal/curriculum': { title: 'Lessons', icon: BookOpen },
  '/portal/coaching': { title: 'Coaching', icon: Mic },
  '/portal/classes': { title: 'My Classes', icon: Users },
  '/portal/coaching/analytics': { title: 'Analytics', icon: BarChart3 },
};

/**
 * Colour rule: a feature colour is ONLY a page-heading icon. Every icon in the
 * menu and its sheet is neutral grey; the current page's row is selected indigo.
 */
const TILE = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-nu-neutral-tile text-nu-neutral-icon';
const ROW_CURRENT = 'bg-nu-select-tint';
const ROW_PRESS = 'active:bg-nu-ink-xlight';

/**
 * The phone bar's spacing (operator spec, DESIGN.md): 10px 6px 14px plus the
 * safe area, square corners; items share the width, 4px between a 23px icon and
 * an 11.5px/700 label; the active icon sits in a 56x32 translucent pill.
 */
const BAR = 'md:hidden fixed inset-x-0 bottom-0 z-50 flex items-stretch bg-nu-ink px-[6px] pt-[10px] pb-[calc(14px+env(safe-area-inset-bottom))] shadow-[0_-6px_18px_rgba(20,22,29,0.18)]';
const BAR_ITEM = 'flex min-h-[56px] min-w-[56px] flex-1 flex-col items-center justify-start gap-1 rounded-2xl transition-colors';
const PILL = 'flex h-8 w-14 items-center justify-center rounded-2xl';
const BAR_LABEL = 'w-full truncate text-center text-[11.5px] font-bold leading-4 rtl:leading-[1.8]';

function BarItemContent({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <>
      <span data-pill className={cn(PILL, active && 'bg-nu-frame-translucent')}>
        <Icon className={cn('h-[23px] w-[23px] shrink-0', active && 'text-nu-leaf')} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
      </span>
      <span data-label className={BAR_LABEL}>{label}</span>
    </>
  );
}

function relabel(items: NavItem[], leader: boolean): NavItem[] {
  if (leader) return items;
  return items.map((i) => (TEACHER_RELABEL[i.path] ? { ...i, ...TEACHER_RELABEL[i.path] } : i));
}

const FOCUS = 'outline-none focus-visible:ring-[3px] focus-visible:ring-nu-focus';

interface Props {
  leader: boolean;
  /** Every place, in the old order (desktop). */
  navItems: NavItem[];
  /** The places on the phone bar (the old nav's choice). */
  mobileNav: NavItem[];
  /** The rest, in the More sheet. */
  mobileOverflow: NavItem[];
  isActive: (path: string) => boolean;
  accountPath: string;
  firstName?: string | null;
  onLogout: () => void;
}

const NewUiNavigation = ({ leader, navItems, mobileNav, mobileOverflow, isActive, accountPath, firstName, onLogout }: Props) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const desktop = relabel(navItems, leader);
  const bar = relabel(mobileNav, leader);
  const overflow = relabel(mobileOverflow, leader);
  const moreActive = overflow.some((i) => isActive(i.path)) || isActive(accountPath);

  return (
    <>
      {/* Desktop — indigo top bar */}
      <nav data-testid="newui-top-nav" aria-label="Menu" className="hidden md:block bg-nu-ink text-white">
        <div className="container mx-auto px-6">
          <div className="flex h-16 items-center gap-6">
            <div className="flex shrink-0 items-center gap-2.5">
              <img src={nieteLogo} alt="NIETE logo" className="h-9 w-9 rounded-lg object-contain" />
              <span className="text-lg font-extrabold">NIETE</span>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-1">
              {desktop.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[56px] min-w-[56px] items-center gap-2 rounded-xl px-3 text-[15px] font-bold transition-colors lg:px-4',
                      FOCUS,
                      active ? 'bg-nu-frame-translucent text-white' : 'text-nu-nav-label hover:bg-white/[0.08] hover:text-white',
                    )}
                  >
                    <item.icon className={cn('h-5 w-5 shrink-0', active && 'text-nu-leaf')} aria-hidden="true" />
                    <span className="whitespace-nowrap">{item.title}</span>
                  </Link>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Link
                to={accountPath}
                data-testid="portal-user-name"
                aria-label="My account"
                title="My account"
                aria-current={isActive(accountPath) ? 'page' : undefined}
                className={cn(
                  'flex min-h-[56px] min-w-[56px] max-w-[12rem] items-center gap-2 rounded-xl px-3 text-[15px] font-bold transition-colors',
                  FOCUS,
                  isActive(accountPath) ? 'bg-nu-frame-translucent text-white' : 'text-nu-nav-label hover:bg-white/[0.08] hover:text-white',
                )}
              >
                <CircleUserRound className={cn('h-5 w-5 shrink-0', isActive(accountPath) && 'text-nu-leaf')} aria-hidden="true" />
                <span className="truncate">{firstName || 'Signed in'}</span>
              </Link>
              <button
                type="button"
                onClick={onLogout}
                className={cn(
                  'flex min-h-[56px] min-w-[56px] items-center gap-2 rounded-xl px-3 text-[15px] font-bold text-nu-nav-label transition-colors hover:bg-white/[0.08] hover:text-white',
                  FOCUS,
                )}
              >
                <LogOut className="h-5 w-5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Phone — indigo bottom bar */}
      <nav data-testid="newui-bottom-nav" aria-label="Menu" className={BAR}>
          {bar.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? 'page' : undefined}
                className={cn(BAR_ITEM, FOCUS, active ? 'text-white' : 'text-nu-nav-label')}
              >
                <BarItemContent icon={item.icon} label={item.title} active={active} />
              </Link>
            );
          })}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="More"
                data-testid="mobile-nav-more"
                className={cn(BAR_ITEM, FOCUS, moreActive ? 'text-white' : 'text-nu-nav-label')}
              >
                <BarItemContent icon={MoreHorizontal} label="More" active={moreActive} />
              </button>
            </SheetTrigger>
            {/* The shared Sheet's own close (×) is 16px and pinned to the physical right, where it
                sits on the title in Urdu. The new UI hides it and puts a 56px close at the END of
                the title row instead. */}
            <SheetContent side="bottom" className="rounded-t-[22px] border-0 bg-nu-surface px-3 pb-5 pt-2.5 [&>button:last-child]:hidden">
              <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-nu-surface-handle" aria-hidden="true" />
              <SheetHeader className="flex-row items-center justify-between space-y-0 ps-1 text-start">
                <SheetTitle className="text-xl font-extrabold text-nu-surface-text">More</SheetTitle>
                <SheetClose
                  data-testid="newui-sheet-close"
                  aria-label="Close"
                  className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-nu-surface-muted active:bg-nu-ink-xlight', FOCUS)}
                >
                  <X className="h-6 w-6" aria-hidden="true" />
                </SheetClose>
              </SheetHeader>
              <div
                data-testid="newui-sheet-rows"
                className="mt-3 flex flex-col overflow-hidden rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card"
              >
                {overflow.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-[56px] items-center gap-3 border-b-[1.5px] border-nu-surface-line px-3.5 py-2 text-base font-bold text-nu-surface-text transition-colors',
                        FOCUS,
                        active ? ROW_CURRENT : ROW_PRESS,
                      )}
                    >
                      <span data-tile className={TILE}>
                        <item.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-nu-surface-chevron rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  );
                })}
                {/* bd-3wb0s — My account, for every role, right above Logout. */}
                <Link
                  to={accountPath}
                  onClick={() => setMoreOpen(false)}
                  data-testid="mobile-nav-account"
                  aria-current={isActive(accountPath) ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[56px] items-center gap-3 border-b-[1.5px] border-nu-surface-line px-3.5 py-2 text-base font-bold text-nu-surface-text transition-colors',
                    FOCUS,
                    isActive(accountPath) ? ROW_CURRENT : ROW_PRESS,
                  )}
                >
                  <span data-tile className={TILE}>
                    <CircleUserRound className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">My account</span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-nu-surface-chevron rtl:rotate-180" aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); onLogout(); }}
                  data-testid="mobile-nav-logout"
                  className={cn(
                    'flex min-h-[56px] items-center gap-3 px-3.5 py-2 text-start text-base font-bold text-nu-surface-muted transition-colors',
                    ROW_PRESS,
                    FOCUS,
                  )}
                >
                  <span data-tile className={TILE}>
                    <LogOut className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
                  </span>
                  <span>Logout</span>
                </button>
              </div>
            </SheetContent>
          </Sheet>
      </nav>
    </>
  );
};

export default NewUiNavigation;
