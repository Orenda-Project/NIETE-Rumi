import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen, ChevronRight, CircleUserRound, ClipboardList, GraduationCap, House, LogOut, Mic, MoreHorizontal, X,
} from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import nieteLogo from '@/assets/niete-logo.png';
import { NAV_COPY } from './copy';
import { closeAccountSheet, openAccountSheet, useAccountSheet } from './accountSheet';
import { PullUpMenu } from './PullUpMenu';
import { initials, useSwipe } from './pullup';

/**
 * bd-5rz1v.12 — the new UI's menu (Direction B, option 2: "indigo menu bar").
 * Rendered by PortalNavigation only while `portal_new_ui` is on for her; with the
 * flag off PortalNavigation returns its old markup untouched.
 *
 * TEACHER (operator's menu decision, 2026-10-03):
 *   phone   — an indigo bottom bar: Home / Lessons / Assessment / Training /
 *             Coaching. No More: what was under it (My Classes, Analytics, My
 *             account, Logout) is in the PULL-UP MENU (bd-5rz1v.18,
 *             PullUpMenu.tsx), opened from the grab handle on top of the bar
 *             or from her AVATAR — her initials — in a slim indigo strip at the
 *             top (or a page's heading band, which then carries it).
 *   desktop — an indigo top bar: Home / Lesson Plans / Assessment / Training /
 *             Coaching, then the avatar (the same panel, as a card).
 *   Assessment is its own page, /portal/assessment (bd-5rz1v.13).
 *
 * LEADER ROLES keep their own items — the bar, the More sheet, the desktop
 * name + Logout — recoloured only.
 *
 * Every target is at least 56px. The item she is on is white with its icon in
 * logo green, in a translucent pill; the others are a muted lilac-grey. Icons in
 * the sheets are neutral grey — a feature colour is only ever its own heading
 * icon. Labels are English literals, like the old nav's: the portal has no
 * catalog for its navigation, and in Urdu the page turns RTL around them. bd-5rz1v.19: the
 * words now live in copy.ts (NAV_COPY) with the rest of the new UI's, ready for Urdu.
 * Spacing is logical (start/end) only, so everything mirrors itself.
 */

export type NavItem = { title: string; path: string; icon: LucideIcon };

const FOCUS = 'outline-none focus-visible:ring-[3px] focus-visible:ring-nu-focus';

/* ── the phone bar ─────────────────────────────────────────────────────────
 * Operator spec (DESIGN.md): 10px 6px 14px plus the safe area, square corners;
 * items share the width, 4px between a 23px icon and the label; the active icon
 * sits in a translucent pill. With five long labels ("Assessment") the teacher
 * bar is TIGHT: 10.5px labels and a 50px pill; the leader bar keeps 11.5px / 56px.
 */
const BAR = 'md:hidden fixed inset-x-0 bottom-0 z-50 flex items-stretch bg-nu-ink px-[6px] pt-[10px] pb-[calc(14px+env(safe-area-inset-bottom))] shadow-nu-nav';
/**
 * bd-5rz1v.18 — the teacher's bar carries the pull-up menu's grab handle in a 16px strip on top
 * (mockup `.nav.handle`). The bottom gives the 6px back, so the bar is still 80px plus the safe
 * area and everything placed above it (BottomActions, the recording bar, the page's padding)
 * stays where it is. `touch-none`: a swipe on the bar is the menu's, not the page's.
 */
const TEACHER_BAR = 'md:hidden fixed inset-x-0 bottom-0 z-50 flex touch-none items-stretch bg-nu-ink px-[6px] pt-[16px] pb-[calc(8px+env(safe-area-inset-bottom))]';
const MENU_PANEL_ID = 'newui-pullup-menu';
const BAR_ITEM = 'flex min-h-[56px] min-w-[56px] flex-1 flex-col items-center justify-start gap-1 rounded-2xl transition-colors';

function BarItemContent({ icon: Icon, label, active, tight }: { icon: LucideIcon; label: string; active: boolean; tight?: boolean }) {
  return (
    <>
      <span data-pill className={cn('flex h-8 items-center justify-center rounded-2xl', tight ? 'w-[50px]' : 'w-14', active && 'bg-nu-frame-translucent')}>
        <Icon className={cn('h-[23px] w-[23px] shrink-0', active && 'text-nu-leaf')} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
      </span>
      <span
        data-label
        className={cn(
          'w-full truncate text-center font-bold leading-4 rtl:leading-[1.8]',
          tight ? 'text-[10.5px] tracking-[-0.01em]' : 'text-[11.5px]',
        )}
      >
        {label}
      </span>
    </>
  );
}

/* ── the desktop bar ─────────────────────────────────────────────────────── */
const TOP_ITEM = 'flex min-h-[56px] min-w-[56px] items-center gap-2 rounded-xl px-3 text-[15px] font-bold transition-colors lg:px-4';
const TOP_ON = 'bg-nu-frame-translucent text-white';
const TOP_OFF = 'text-nu-nav-label hover:bg-white/[0.08] hover:text-white';

function Mark({ className }: { className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2.5', className)}>
      <img src={nieteLogo} alt={NAV_COPY.logoAlt} className="h-9 w-9 rounded-2xl object-contain" />
      <span className="text-lg font-extrabold">{NAV_COPY.brand}</span>
    </div>
  );
}

/* ── sheets ──────────────────────────────────────────────────────────────── */
const TILE = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-nu-neutral-tile text-nu-neutral-icon';
const ROW = 'flex min-h-[56px] items-center gap-3 border-b-[1.5px] border-nu-surface-line px-3.5 py-2 text-base font-bold text-nu-surface-text transition-colors';
const ROW_CURRENT = 'bg-nu-select-tint';
const ROW_PRESS = 'active:bg-nu-ink-xlight';
const SHEET = 'rounded-t-[22px] border-0 bg-nu-surface px-3 pb-5 pt-2.5 [&>button:last-child]:hidden';

/**
 * The shared Sheet's own close (×) is 16px and pinned to the physical right,
 * where it sits on the title in Urdu. The new UI hides it (SHEET) and puts a
 * 56px close at the END of the title row instead.
 */
function SheetBody({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-nu-surface-handle md:hidden" aria-hidden="true" />
      <SheetHeader className="flex-row items-center justify-between space-y-0 ps-1 text-start">
        <SheetTitle className="min-w-0 truncate text-xl font-extrabold text-nu-surface-text">{title}</SheetTitle>
        <SheetClose
          data-testid="newui-sheet-close"
          aria-label={NAV_COPY.close}
          className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-nu-surface-muted active:bg-nu-ink-xlight', FOCUS)}
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </SheetClose>
      </SheetHeader>
      <div
        data-testid="newui-sheet-rows"
        className="mt-3 flex flex-col overflow-hidden rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card [&>*:last-child]:border-b-0"
      >
        {children}
      </div>
      {footer}
    </>
  );
}

function SheetRow({ to, icon: Icon, title, current, onGo, testId }: {
  to: string; icon: LucideIcon; title: string; current: boolean; onGo: () => void; testId?: string;
}) {
  return (
    <Link
      to={to}
      onClick={onGo}
      data-testid={testId}
      aria-current={current ? 'page' : undefined}
      className={cn(ROW, FOCUS, current ? ROW_CURRENT : ROW_PRESS)}
    >
      <span data-tile className={TILE}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-nu-surface-chevron rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

/* ── the teacher's menu ─────────────────────────────────────────────────── */

type TeacherItem = {
  key: string; title: string; desktopTitle: string; to: string; icon: LucideIcon;
  match: (pathname: string, tab: string | null) => boolean;
};

const under = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`);

const TEACHER_ITEMS: TeacherItem[] = [
  // bd-5rz1v.17 — Home's lists (/portal/dashboard/lesson-plans, /coaching) are Home's own pages.
  { key: 'home', title: NAV_COPY.items.home, desktopTitle: NAV_COPY.items.home, to: '/portal/dashboard', icon: House, match: under('/portal/dashboard') },
  {
    key: 'lessons', title: NAV_COPY.items.lessons, desktopTitle: NAV_COPY.items.lessonPlans, to: '/portal/curriculum', icon: BookOpen,
    match: (p, tab) => p === '/portal/curriculum' && tab !== 'assessment',
  },
  // bd-5rz1v.13 — Assessment is its own page; an old link to the Curriculum tab still lights it.
  {
    key: 'assessment', title: NAV_COPY.items.assessment, desktopTitle: NAV_COPY.items.assessment, to: '/portal/assessment', icon: ClipboardList,
    match: (p, tab) => under('/portal/assessment')(p) || (p === '/portal/curriculum' && tab === 'assessment'),
  },
  { key: 'training', title: NAV_COPY.items.training, desktopTitle: NAV_COPY.items.training, to: '/portal/training', icon: GraduationCap, match: under('/portal/training') },
  { key: 'coaching', title: NAV_COPY.items.coaching, desktopTitle: NAV_COPY.items.coaching, to: '/portal/coaching', icon: Mic, match: under('/portal/coaching') },
];

/**
 * Her initials, a 40px green circle in a 56px target. Every avatar opens the same panel — the
 * pull-up menu (bd-5rz1v.18; accountSheet.ts holds whether it is open). bd-5rz1v.17: Home's
 * heading band shows one too.
 */
export function AccountAvatar({ name, testId }: { name?: string | null; testId: string }) {
  const letters = initials(name);
  return (
    <button
      type="button"
      aria-label={NAV_COPY.account}
      data-testid={testId}
      onClick={openAccountSheet}
      className={cn('flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-center rounded-full', FOCUS)}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-nu-button text-sm font-extrabold text-white ring-2 ring-white/25">
        {letters || <CircleUserRound className="h-6 w-6" aria-hidden="true" />}
      </span>
    </button>
  );
}

function TeacherNavigation({ accountPath, firstName, lastName, schoolName, onLogout, hideStrip }: {
  accountPath: string; firstName?: string | null; lastName?: string | null; schoolName?: string | null;
  onLogout: () => void; hideStrip?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useAccountSheet();
  // Every page mounts its own menu; a panel left open does not follow her to the next page.
  useEffect(() => () => closeAccountSheet(), []);
  const { pathname, search } = useLocation();
  const tab = new URLSearchParams(search).get('tab');
  const close = () => setMenuOpen(false);
  // bd-5rz1v.18 — a swipe up on the bar opens the pull-up menu; a swipe down closes it.
  const barSwipe = useSwipe({ onUp: () => setMenuOpen(true), onDown: close });

  return (
    <>
      {/* Desktop — indigo top bar */}
      <nav data-testid="newui-top-nav" aria-label={NAV_COPY.menu} className="hidden md:block bg-nu-ink text-white">
        <div className="container mx-auto px-6">
          <div className="flex h-16 items-center gap-6">
            <Mark />
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {TEACHER_ITEMS.map((item) => {
                const active = item.match(pathname, tab);
                return (
                  <Link key={item.key} to={item.to} aria-current={active ? 'page' : undefined} className={cn(TOP_ITEM, FOCUS, active ? TOP_ON : TOP_OFF)}>
                    <item.icon className={cn('h-5 w-5 shrink-0', active && 'text-nu-leaf')} aria-hidden="true" />
                    <span className="whitespace-nowrap">{item.desktopTitle}</span>
                  </Link>
                );
              })}
            </div>
            <AccountAvatar name={firstName} testId="newui-avatar-desktop" />
          </div>
        </div>
      </nav>

      {/* Phone — a slim indigo strip with the NIETE mark and her avatar, on pages that have no
          heading band yet. A page with a MainHeading carries the avatar itself (hideStrip). */}
      {hideStrip ? null : (
        <div
          data-testid="newui-top-strip"
          className="md:hidden flex items-center justify-between bg-nu-ink pe-1 ps-4 pt-[env(safe-area-inset-top)] text-white"
        >
          <Mark />
          <AccountAvatar name={firstName} testId="newui-avatar" />
        </div>
      )}

      {/* bd-5rz1v.18 — the pull-up menu: the one place for everything else. */}
      <PullUpMenu
        id={MENU_PANEL_ID}
        open={menuOpen}
        onClose={close}
        firstName={firstName}
        lastName={lastName}
        schoolName={schoolName}
        pathname={pathname}
        accountPath={accountPath}
        onLogout={onLogout}
      />

      {/* Phone — indigo bottom bar, with the grab handle on top. Open, the panel rises from it and
          the bar stays as the menu row at its foot, above the dimmed page. */}
      <nav
        data-testid="newui-bottom-nav"
        aria-label={NAV_COPY.menu}
        className={cn(TEACHER_BAR, menuOpen ? 'border-t border-nu-pullup-tile' : 'shadow-nu-nav')}
        {...barSwipe}
      >
        {/* The handle: the bar's own empty space is its button, behind the five items. */}
        <button
          type="button"
          data-testid="newui-menu-handle"
          aria-label={NAV_COPY.openMenu}
          aria-expanded={menuOpen}
          aria-controls={MENU_PANEL_ID}
          onClick={() => setMenuOpen(!menuOpen)}
          className={cn('absolute inset-0 min-h-[56px] w-full', FOCUS)}
        />
        {menuOpen ? null : (
          <span
            data-testid="newui-menu-grab"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-[6px] mx-auto h-1 w-[38px] rounded bg-nu-pullup-grab"
          />
        )}
        {TEACHER_ITEMS.map((item) => {
          const active = item.match(pathname, tab);
          return (
            <Link
              key={item.key}
              to={item.to}
              onClick={close}
              aria-current={active ? 'page' : undefined}
              className={cn(BAR_ITEM, 'relative z-[1]', FOCUS, active ? 'text-white' : 'text-nu-nav-label')}
            >
              <BarItemContent icon={item.icon} label={item.title} active={active} tight />
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/* ── leader roles: their own items, recoloured ──────────────────────────── */

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
  /** bd-5rz1v.18 — the pull-up menu's who row: the rest of her name, her school. */
  lastName?: string | null;
  schoolName?: string | null;
  onLogout: () => void;
  /** The page draws its own heading band, which carries the avatar: no phone strip. */
  hideStrip?: boolean;
}

function LeaderNavigation({ navItems, mobileNav, mobileOverflow, isActive, accountPath, firstName, onLogout }: Omit<Props, 'leader' | 'hideStrip' | 'lastName' | 'schoolName'>) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = mobileOverflow.some((i) => isActive(i.path)) || isActive(accountPath);
  const close = () => setMoreOpen(false);

  return (
    <>
      {/* Desktop — indigo top bar */}
      <nav data-testid="newui-top-nav" aria-label={NAV_COPY.menu} className="hidden md:block bg-nu-ink text-white">
        <div className="container mx-auto px-6">
          <div className="flex h-16 items-center gap-6">
            <Mark />
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {navItems.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined} className={cn(TOP_ITEM, FOCUS, active ? TOP_ON : TOP_OFF)}>
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
                aria-label={NAV_COPY.myAccount}
                title={NAV_COPY.myAccount}
                aria-current={isActive(accountPath) ? 'page' : undefined}
                className={cn(TOP_ITEM, 'max-w-[12rem] lg:px-3', FOCUS, isActive(accountPath) ? TOP_ON : TOP_OFF)}
              >
                <CircleUserRound className={cn('h-5 w-5 shrink-0', isActive(accountPath) && 'text-nu-leaf')} aria-hidden="true" />
                <span className="truncate">{firstName || NAV_COPY.signedIn}</span>
              </Link>
              <button type="button" onClick={onLogout} className={cn(TOP_ITEM, 'lg:px-3', FOCUS, TOP_OFF)}>
                <LogOut className="h-5 w-5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                <span>{NAV_COPY.logout}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Phone — indigo bottom bar, their items + More */}
      <nav data-testid="newui-bottom-nav" aria-label={NAV_COPY.menu} className={BAR}>
        {mobileNav.map((item) => {
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
              aria-label={NAV_COPY.more}
              data-testid="mobile-nav-more"
              className={cn(BAR_ITEM, FOCUS, moreActive ? 'text-white' : 'text-nu-nav-label')}
            >
              <BarItemContent icon={MoreHorizontal} label={NAV_COPY.more} active={moreActive} />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className={SHEET}>
            <SheetBody title={NAV_COPY.more}>
              {mobileOverflow.map((item) => (
                <SheetRow key={item.path} to={item.path} icon={item.icon} title={item.title} current={isActive(item.path)} onGo={close} />
              ))}
              {/* bd-3wb0s — My account, for every role, right above Logout. */}
              <SheetRow
                to={accountPath}
                icon={CircleUserRound}
                title={NAV_COPY.myAccount}
                current={isActive(accountPath)}
                onGo={close}
                testId="mobile-nav-account"
              />
              <button
                type="button"
                onClick={() => { close(); onLogout(); }}
                data-testid="mobile-nav-logout"
                className={cn(ROW, 'text-start text-nu-surface-muted', FOCUS, ROW_PRESS)}
              >
                <span data-tile className={TILE}>
                  <LogOut className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
                </span>
                <span>{NAV_COPY.logout}</span>
              </button>
            </SheetBody>
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}

const NewUiNavigation = ({ leader, ...rest }: Props) =>
  (leader
    ? <LeaderNavigation {...rest} />
    : (
      <TeacherNavigation
        accountPath={rest.accountPath}
        firstName={rest.firstName}
        lastName={rest.lastName}
        schoolName={rest.schoolName}
        onLogout={rest.onLogout}
        hideStrip={rest.hideStrip}
      />
    ));

export default NewUiNavigation;
