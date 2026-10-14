import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CircleUserRound, Eye, GraduationCap, House, Info, LogOut, Users, type LucideIcon } from 'lucide-react';
import nieteLogo from '@/assets/niete-logo.png';
import { cn } from '@/lib/utils';
import { PRIVACY_POLICY_PATH } from '../lib/legalLinks';
import type { AnalyticsWords } from './copy';
import { SCHOOLS_TABS, tabPath, type SchoolsTab } from './tabs';

/**
 * bd-s6qbts.3 — the analytics-only account's frame: this page and Log out, nothing else (the teacher/leader menu
 * would only be doors back to pages it cannot use).
 *
 * bd-97x22y.2 — in the ICT dashboard's structure (PLAN v6 §1), in the NIETE portal's look:
 *   desktop (≥1024px)  a left sidebar with the six tabs in her order, the mark at its top; our dark top bar beside it
 *                      ("Schools analytics", the account's name, Log out); then her white page-heading strip
 *   phone              our slim dark top strip (mark, "Schools analytics", Log out) and the six tabs in a row that
 *                      scrolls sideways in its own box, so the page itself never does
 * Indigo is the frame and the selection; the tab she is on gets the kit's translucent pill and its icon in logo
 * green (newui/tokens NAV). Every tab link carries the address's ?region / ?from / ?to with it.
 */
export const TAB_ICON: Record<SchoolsTab, LucideIcon> = {
  overview: House,
  lp: BarChart3,
  training: GraduationCap,
  observations: Eye,
  coaching: Users,
  info: Info,
};

const FOCUS_ON_DARK = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nu-focus';

export function AnalyticsFrame({ c, name, onLogout, tab, search, subtitle, children }: {
  c: AnalyticsWords;
  name?: string | null;
  onLogout: () => void;
  tab: SchoolsTab;
  /** The address's query (?region=…&from=…&to=…), kept by every tab link. */
  search: string;
  /** A line under the tab's name (the Overview's lede). */
  subtitle?: string;
  children: ReactNode;
}) {
  const to = (t: SchoolsTab) => ({ pathname: tabPath(t), search });
  const Icon = TAB_ICON[tab];

  return (
    <div lang={c.lang} dir={c.dir} className="flex min-h-screen bg-secondary">
      {/* The dark column runs the page's full height; the menu in it stays on screen as the page scrolls. */}
      <div className="hidden w-60 shrink-0 bg-primary shadow-[4px_0_20px_rgba(0,0,0,0.12)] lg:block">
      <nav
        data-testid="analytics-sidebar"
        aria-label={c.frame.tabsMenu}
        className="sticky top-0 hidden h-screen flex-col text-primary-foreground lg:flex"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
          <img src={nieteLogo} alt={c.frame.logoAlt} className="h-9 w-9 rounded object-contain" />
          <span className="text-lg font-semibold">{c.frame.brand}</span>
        </div>
        <div className="flex flex-col gap-1 px-3 pt-4">
          {SCHOOLS_TABS.map((t) => {
            const on = t === tab;
            const TabIcon = TAB_ICON[t];
            return (
              <Link
                key={t}
                to={to(t)}
                data-testid={`tab-link-${t}`}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex h-12 items-center gap-3 rounded-xl px-3.5 text-base font-semibold transition-colors',
                  FOCUS_ON_DARK,
                  on ? 'bg-white/15 text-white' : 'text-nu-nav-label hover:bg-white/10 hover:text-white',
                )}
              >
                <TabIcon className={cn('h-5 w-5 shrink-0', on ? 'text-nu-leaf' : '')} aria-hidden="true" />
                <span>{c.tabs[t]}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden h-16 shrink-0 items-center justify-between border-b border-white/10 bg-primary px-8 text-primary-foreground lg:flex">
          <span className="text-lg font-semibold">{c.frame.page}</span>
          <div className="flex items-center gap-2">
            <span data-testid="analytics-user-name" className="flex max-w-[14rem] items-center gap-2 truncate px-2 py-2 text-sm font-medium text-white/70">
              <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{name || c.frame.signedIn}</span>
            </span>
            <button
              type="button"
              onClick={onLogout}
              className={cn('flex items-center gap-2 rounded-md px-4 py-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white', FOCUS_ON_DARK)}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>{c.frame.logout}</span>
            </button>
          </div>
        </header>

        <header className="flex h-14 shrink-0 items-center gap-2.5 bg-primary ps-4 pe-2 text-primary-foreground lg:hidden">
          <img src={nieteLogo} alt={c.frame.logoAlt} className="h-7 w-7 rounded object-contain" />
          <span className="truncate text-base font-semibold">{c.frame.page}</span>
          <button
            type="button"
            onClick={onLogout}
            className={cn('ms-auto flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white', FOCUS_ON_DARK)}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>{c.frame.logout}</span>
          </button>
        </header>

        <nav data-testid="analytics-tabrow" aria-label={c.frame.tabsMenu} className="sticky top-0 z-30 border-b border-border bg-white shadow-sm lg:hidden">
          {/* Its own sideways scroll: six tabs never widen the page. */}
          <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SCHOOLS_TABS.map((t) => {
              const on = t === tab;
              const TabIcon = TAB_ICON[t];
              return (
                <Link
                  key={t}
                  to={to(t)}
                  data-testid={`tabrow-link-${t}`}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <TabIcon className={cn('h-4 w-4 shrink-0', on ? 'text-nu-leaf' : '')} aria-hidden="true" />
                  <span>{c.tabs[t]}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Her page-heading strip: the tab's icon and name. */}
        <div className="border-b border-border bg-white px-4 py-3 shadow-sm sm:px-6 lg:px-8">
          <div className={cn('mx-auto flex max-w-7xl gap-3', subtitle ? 'items-start' : 'items-center')}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nu-leaf-light" aria-hidden="true">
              <Icon className="h-5 w-5 text-nu-button" />
            </span>
            <div className="min-w-0">
              <h1 data-testid="tab-title" className="text-xl font-bold leading-tight text-foreground">{c.tabs[tab]}</h1>
              {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-10 pt-5 sm:px-6 lg:px-8 lg:pt-6">
          {children}
          <footer className="mt-10 border-t border-border pt-4 text-sm text-muted-foreground">
            <Link to={PRIVACY_POLICY_PATH} className="underline-offset-4 hover:text-foreground hover:underline">
              {c.frame.privacy}
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
