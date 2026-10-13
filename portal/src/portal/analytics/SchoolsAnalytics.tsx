import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '../hooks/useAuth';
import { isAnalyticsOnly } from '../lib/homeRoute';
import { analytics } from '../services/api';
import { useLang } from '../teacher/i18n';
import { shortDate } from '../newui/range';
import type { SchoolsAnalyticsResponse } from '../types/portal';
import { AnalyticsFrame } from './AnalyticsFrame';
import { analyticsCopy } from './copy';
import { Filters } from './Filters';
import { count, startsBeforeLpOpens, windowText } from './format';
import { HowCounted } from './HowCounted';
import { Overview } from './Overview';
import { RegionCards } from './RegionCards';
import { SchoolsList } from './SchoolsList';
import { regionParam, useSchoolsView } from './view';

/**
 * bd-s6qbts.3 — /portal/analytics/schools: school-wise NIETE usage and observation scores across the ICT regions,
 * for an analytics-only account (FDE / AEO; PLAN v2 §1, v3 §2–§4). One page: region and period at the top, the
 * overview tiles, a card per region (All regions only), then every school.
 *
 * Objective counts only (operator, 2026-10-13): things that happened, "x of N teachers" so schools of different
 * sizes compare fairly, and score averages with their n. No percentages, no colour bands, no thresholds.
 *
 * Who may see it is decided by the server (requireAnalyticsViewer, 403 otherwise) and, for routing, by the one rule
 * in lib/homeRoute (analytics/AnalyticsOnlyGuard sends anyone else to their own home). Nothing here is fetched
 * until the signed-in user is known to be an analytics-only account.
 */
type Status = 'loading' | 'ready' | 'refetching' | 'forbidden' | 'error';

const SchoolsAnalytics = () => {
  const { user, loading, logout } = useAuth();
  const c = analyticsCopy(useLang());
  const view = useSchoolsView();
  const phone = useIsMobile();
  const [data, setData] = useState<SchoolsAnalyticsResponse | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const hasData = useRef(false);

  const allowed = !loading && isAnalyticsOnly(user);
  const region = regionParam(view.region);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    // The first read owns the page's placeholder; every later one keeps the page (and the filter she is using) on
    // screen with "Updating…" beside the filters.
    setStatus(hasData.current ? 'refetching' : 'loading');
    analytics
      .getSchools({ from: view.from, to: view.to, region })
      .then((d) => {
        if (!alive) return;
        hasData.current = true;
        setData(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (!alive) return;
        // Old numbers under a new filter would be read as the new ones: drop them.
        hasData.current = false;
        setData(null);
        setStatus(err?.response?.status === 403 ? 'forbidden' : 'error');
      });
    return () => { alive = false; };
  }, [allowed, view.from, view.to, region, attempt]);

  if (!loading && !user) return <Navigate to="/portal/login" replace />;
  // Anyone else is sent to their own home by the guard around the routes; nothing of this page renders meanwhile.
  if (!loading && !isAnalyticsOnly(user)) return null;

  const frame = (body: ReactNode) => (
    <AnalyticsFrame c={c} name={user?.firstName} onLogout={logout}>
      <header className="mb-6">
        <h1 className="mb-2 text-3xl font-light sm:text-4xl">{c.title}</h1>
        <p className="max-w-3xl text-muted-foreground">{c.lede}</p>
      </header>
      {body}
    </AnalyticsFrame>
  );

  if (status === 'forbidden') {
    return frame(
      <div data-testid="analytics-forbidden" className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <p className="text-muted-foreground">{c.states.forbidden}</p>
      </div>,
    );
  }
  if (status === 'error') {
    return frame(
      <div data-testid="analytics-error" role="alert" className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <p className="mb-4 text-muted-foreground">{c.states.error}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {c.states.retry}
        </button>
      </div>,
    );
  }
  if (!data || status === 'loading') {
    return frame(
      <div aria-busy="true" aria-label={c.states.loading} className="flex flex-col gap-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[18px]" />)}
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>,
    );
  }

  const overview = data.overview;
  const regions = data.regions ?? [];
  const schools = data.schools ?? [];
  const lpOpensNote = startsBeforeLpOpens(view.from, data.lpOpensLoggedSince)
    ? c.loggedSince(shortDate(data.lpOpensLoggedSince, false, c.months))
    : null;
  const regionName = view.region ? regions.find((r) => r.region.toLowerCase() === view.region?.toLowerCase())?.region ?? view.region : c.filters.allRegions;

  return frame(
    <>
      <Filters
        c={c}
        regions={regions}
        region={view.region}
        onRegion={view.setRegion}
        preset={view.preset}
        from={view.from}
        to={view.to}
        onPreset={view.setPreset}
        onRange={view.setRange}
        refetching={status === 'refetching'}
      />

      {/* While the next numbers are on their way the current ones stay, dimmed, so they are not read as the new ones. */}
      <div aria-busy={status === 'refetching'} className={status === 'refetching' ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <p data-testid="scope-line" className="mb-3 text-sm text-muted-foreground">
        <b className="font-semibold text-foreground">{regionName}</b>
        {` · ${c.scope.schools(count(overview.schools, c))} · ${windowText(view.from, view.to, c)}`}
      </p>

      <Overview c={c} overview={overview} lpOpensNote={lpOpensNote} />

      {!view.region && <RegionCards c={c} regions={regions} onRegion={view.setRegion} />}

      <SchoolsList c={c} schools={schools} phone={phone} lpOpensNote={lpOpensNote} />
      </div>

      <HowCounted c={c} />
    </>,
  );
};

export default SchoolsAnalytics;
