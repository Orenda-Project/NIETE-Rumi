import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Award, BarChart3, BookOpen, ChevronRight, CircleUserRound, ClipboardList, GraduationCap, House, LogOut, Mic,
  MoreHorizontal, Users, X,
} from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import nieteLogo from '@/assets/niete-logo.png';

/**
 * bd-5rz1v.12 — the new UI's menu (Direction B, option 2: "indigo menu bar").
 * Rendered by PortalNavigation only while `portal_new_ui` is on for her; with the
 * flag off PortalNavigation returns its old markup untouched.
 *
 * TEACHER (operator's menu decision, 2026-10-03):
 *   phone   — an indigo bottom bar: Home / Lessons / Assessment / Training /
 *             Coaching. No More: what was under it (My Classes, Analytics, My
 *             account, Logout) sits behind an AVATAR — her initials — in a slim
 *             indigo strip at the top, which opens an account sheet (+
 *             Certificates). The strip holds the avatar until the page heading
 *             band (DESIGN.md) is built; then the band carries it.
 *   desktop — an indigo top bar: Home / Lesson Plans / Assessment / Training /
 *             Coaching, then the avatar (the same sheet).
 *   Assessment is still a tab of /portal/curriculum, so its item opens
 *   ?tab=assessment until it becomes a page of its own.
 *
 * LEADER ROLES keep their own items — the bar, the More sheet, the desktop
 * name + Logout — recoloured only.
 *
 * Every target is at least 56px. The item she is on is white with its icon in
 * logo green, in a translucent pill; the others are a muted lilac-grey. Icons in
 * the sheets are neutral grey — a feature colour is only ever its own heading
 * icon. Labels are English literals, like the old nav's: the portal has no
 * catalog for its navigation, and in Urdu the page turns RTL around them.
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
const BAR = 'md:hidden fixed inset-x-0 bottom-0 z-50 flex items-stretch bg-nu-ink px-[6px] pt-[10px] pb-[calc(14px+env(safe-area-inset-bottom))] shadow-[0_-6px_18px_rgba(20,22,29,0.18)]';
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
      <img src={nieteLogo} alt="NIETE logo" className="h-9 w-9 rounded-lg object-contain" />
      <span className="text-lg font-extrabold">NIETE</span>
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
          aria-label="Close"
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
  { key: 'home', title: 'Home', desktopTitle: 'Home', to: '/portal/dashboard', icon: House, match: (p) => p === '/portal/dashboard' },
  {
    key: 'lessons', title: 'Lessons', desktopTitle: 'Lesson Plans', to: '/portal/curriculum', icon: BookOpen,
    match: (p, tab) => p === '/portal/curriculum' && tab !== 'assessment',
  },
  {
    key: 'assessment', title: 'Assessment', desktopTitle: 'Assessment', to: '/portal/curriculum?tab=assessment', icon: ClipboardList,
    match: (p, tab) => p === '/portal/curriculum' && tab === 'assessment',
  },
  { key: 'training', title: 'Training', desktopTitle: 'Training', to: '/portal/training', icon: GraduationCap, match: under('/portal/training') },
  { key: 'coaching', title: 'Coaching', desktopTitle: 'Coaching', to: '/portal/coaching', icon: Mic, match: under('/portal/coaching') },
];

/** Behind the avatar: everything the old nav reached that the bar does not, plus Certificates. */
const ACCOUNT_ROWS: Array<{ to: string; title: string; icon: LucideIcon }> = [
  { to: '/portal/classes', title: 'My Classes', icon: Users },
  { to: '/portal/coaching/analytics', title: 'Analytics', icon: BarChart3 },
  { to: '/portal/training/certificates', title: 'Certificates', icon: Award },
];

/** Her initials: the first letter of the first two words of her name. */
function initials(name?: string | null): string {
  return (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => Array.from(w)[0]).join('').toUpperCase();
}

function Avatar({ name, onOpen, testId }: { name?: string | null; onOpen: () => void; testId: string }) {
  const letters = initials(name);
  return (
    <button
      type="button"
      aria-label="Account"
      data-testid={testId}
      onClick={onOpen}
      className={cn('flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-center rounded-full', FOCUS)}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-nu-button text-sm font-extrabold text-white ring-2 ring-white/25">
        {letters || <CircleUserRound className="h-6 w-6" aria-hidden="true" />}
      </span>
    </button>
  );
}

function TeacherNavigation({ accountPath, firstName, onLogout }: { accountPath: string; firstName?: string | null; onLogout: () => void }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const { pathname, search } = useLocation();
  const tab = new URLSearchParams(search).get('tab');
  const close = () => setAccountOpen(false);
  const open = () => setAccountOpen(true);

  return (
    <>
      {/* Desktop — indigo top bar */}
      <nav data-testid="newui-top-nav" aria-label="Menu" className="hidden md:block bg-nu-ink text-white">
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
            <Avatar name={firstName} onOpen={open} testId="newui-avatar-desktop" />
          </div>
        </div>
      </nav>

      {/* Phone — a slim indigo strip with the NIETE mark and her avatar */}
      <div
        data-testid="newui-top-strip"
        className="md:hidden flex items-center justify-between bg-nu-ink pe-1 ps-4 pt-[env(safe-area-inset-top)] text-white"
      >
        <Mark />
        <Avatar name={firstName} onOpen={open} testId="newui-avatar" />
      </div>

      {/* Phone — indigo bottom bar */}
      <nav data-testid="newui-bottom-nav" aria-label="Menu" className={BAR}>
        {TEACHER_ITEMS.map((item) => {
          const active = item.match(pathname, tab);
          return (
            <Link
              key={item.key}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={cn(BAR_ITEM, FOCUS, active ? 'text-white' : 'text-nu-nav-label')}
            >
              <BarItemContent icon={item.icon} label={item.title} active={active} tight />
            </Link>
          );
        })}
      </nav>

      {/* The account sheet — from the bottom on a phone, a card under the avatar on a desktop */}
      <Sheet open={accountOpen} onOpenChange={setAccountOpen}>
        <SheetContent
          side="bottom"
          className={cn(SHEET, 'md:inset-x-auto md:bottom-auto md:end-6 md:top-[72px] md:w-[380px] md:rounded-2xl md:pt-4')}
        >
          <SheetBody
            title={firstName || 'Account'}
            footer={(
              <button
                type="button"
                onClick={() => { close(); onLogout(); }}
                data-testid="mobile-nav-logout"
                className={cn(
                  'mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full border-2 border-nu-button-secondary-border bg-nu-button-secondary text-base font-extrabold text-nu-button-destructive',
                  FOCUS,
                )}
              >
                <LogOut className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
                <span>Logout</span>
              </button>
            )}
          >
            {ACCOUNT_ROWS.map((r) => (
              <SheetRow key={r.to} to={r.to} icon={r.icon} title={r.title} current={pathname === r.to} onGo={close} />
            ))}
            {/* bd-3wb0s — My account (privacy policy, account deletion) stays one tap from here. */}
            <SheetRow
              to={accountPath}
              icon={CircleUserRound}
              title="My account"
              current={pathname === accountPath}
              onGo={close}
              testId="mobile-nav-account"
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
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
  onLogout: () => void;
}

function LeaderNavigation({ navItems, mobileNav, mobileOverflow, isActive, accountPath, firstName, onLogout }: Omit<Props, 'leader'>) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = mobileOverflow.some((i) => isActive(i.path)) || isActive(accountPath);
  const close = () => setMoreOpen(false);

  return (
    <>
      {/* Desktop — indigo top bar */}
      <nav data-testid="newui-top-nav" aria-label="Menu" className="hidden md:block bg-nu-ink text-white">
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
                aria-label="My account"
                title="My account"
                aria-current={isActive(accountPath) ? 'page' : undefined}
                className={cn(TOP_ITEM, 'max-w-[12rem] lg:px-3', FOCUS, isActive(accountPath) ? TOP_ON : TOP_OFF)}
              >
                <CircleUserRound className={cn('h-5 w-5 shrink-0', isActive(accountPath) && 'text-nu-leaf')} aria-hidden="true" />
                <span className="truncate">{firstName || 'Signed in'}</span>
              </Link>
              <button type="button" onClick={onLogout} className={cn(TOP_ITEM, 'lg:px-3', FOCUS, TOP_OFF)}>
                <LogOut className="h-5 w-5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Phone — indigo bottom bar, their items + More */}
      <nav data-testid="newui-bottom-nav" aria-label="Menu" className={BAR}>
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
              aria-label="More"
              data-testid="mobile-nav-more"
              className={cn(BAR_ITEM, FOCUS, moreActive ? 'text-white' : 'text-nu-nav-label')}
            >
              <BarItemContent icon={MoreHorizontal} label="More" active={moreActive} />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className={SHEET}>
            <SheetBody title="More">
              {mobileOverflow.map((item) => (
                <SheetRow key={item.path} to={item.path} icon={item.icon} title={item.title} current={isActive(item.path)} onGo={close} />
              ))}
              {/* bd-3wb0s — My account, for every role, right above Logout. */}
              <SheetRow
                to={accountPath}
                icon={CircleUserRound}
                title="My account"
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
                <span>Logout</span>
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
    : <TeacherNavigation accountPath={rest.accountPath} firstName={rest.firstName} onLogout={rest.onLogout} />);

export default NewUiNavigation;
