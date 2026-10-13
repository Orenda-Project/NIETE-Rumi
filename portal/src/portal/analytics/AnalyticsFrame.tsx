import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CircleUserRound, LogOut } from 'lucide-react';
import nieteLogo from '@/assets/niete-logo.png';
import { ANALYTICS_HOME } from '../lib/homeRoute';
import { PRIVACY_POLICY_PATH } from '../lib/legalLinks';
import type { AnalyticsWords } from './copy';

/**
 * bd-s6qbts.3 — the analytics-only account's frame: this page and Log out, nothing else (the teacher/leader menu
 * would only be doors back to pages it cannot use). Desktop: the portal's dark top bar (PortalNavigation's look).
 * Phone: a slim top strip with the mark, and the portal's bottom bar with the two items.
 */
export function AnalyticsFrame({ c, name, onLogout, children }: {
  c: AnalyticsWords;
  name?: string | null;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div lang={c.lang} dir={c.dir} className="min-h-screen bg-secondary">
      <nav aria-label={c.frame.menu} className="hidden md:block bg-primary text-primary-foreground border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img src={nieteLogo} alt={c.frame.logoAlt} className="h-8 w-8 rounded object-contain" />
            <span className="text-lg font-semibold">{c.frame.brand}</span>
          </div>
          <Link
            to={ANALYTICS_HOME}
            aria-current="page"
            className="flex items-center gap-2 rounded-md bg-white/20 px-4 py-2 text-white"
          >
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            <span>{c.frame.page}</span>
          </Link>
          <div className="flex items-center gap-2">
            <span data-testid="analytics-user-name" className="flex max-w-[14rem] items-center gap-2 truncate px-2 py-2 text-sm font-medium text-white/70">
              <CircleUserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{name || c.frame.signedIn}</span>
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>{c.frame.logout}</span>
            </button>
          </div>
        </div>
      </nav>

      <header className="flex h-14 items-center gap-2.5 bg-primary px-4 text-primary-foreground md:hidden">
        <img src={nieteLogo} alt={c.frame.logoAlt} className="h-7 w-7 rounded object-contain" />
        <span className="text-base font-semibold">{c.frame.brand}</span>
        <span className="ms-auto max-w-[55%] truncate text-sm text-white/70">{name || c.frame.signedIn}</span>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 md:pb-10 md:pt-8 lg:px-8">
        {children}
        <footer className="mt-10 border-t border-border pt-4 text-sm text-muted-foreground">
          <Link to={PRIVACY_POLICY_PATH} className="underline-offset-4 hover:text-foreground hover:underline">
            {c.frame.privacy}
          </Link>
        </footer>
      </main>

      <nav aria-label={c.frame.menu} className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-white shadow-lg md:hidden">
        <div className="flex h-16 items-center justify-around">
          <Link to={ANALYTICS_HOME} aria-current="page" className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-accent">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs">{c.frame.pageShort}</span>
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-muted-foreground"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs">{c.frame.logout}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
