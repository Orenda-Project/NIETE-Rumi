import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '../hooks/useAuth';
import { isAnalyticsOnly } from '../lib/homeRoute';
import { analytics } from '../services/api';
import { useLang } from '../teacher/i18n';
import { shortDate } from '../newui/range';
import type { CoachingAnalyticsResponse, SchoolsAnalyticsResponse } from '../types/portal';
import { AnalyticsFrame } from './AnalyticsFrame';
import { analyticsCopy } from './copy';
import { Filters } from './Filters';
import { count, startsBeforeLpOpens, windowText } from './format';
import { COACHING_TABS, SCHOOLS_PATH, isSchoolsTab, type SchoolsTab } from './tabs';
import { regionParam, useSchoolsView } from './view';
import { CoachingTab } from './views/CoachingTab';
import { InfoTab } from './views/InfoTab';
import { LpTab } from './views/LpTab';
import { ObservationKindToggle, ObservationsTab } from './views/ObservationsTab';
import { OverviewTab } from './views/OverviewTab';
import type { CoachingState, TabProps } from './views/shared';
import { TrainingTab } from './views/TrainingTab';

/**
 * bd-s6qbts.3 — /portal/analytics/schools: school-wise NIETE usage and observation scores across the ICT regions,
 * for an analytics-only account (FDE / AEO; PLAN v2 §1, v3 §2–§4).
 *
 * bd-97x22y.2 — in the ICT dashboard's structure (PLAN v6): six tabs at /portal/analytics/schools/<tab> (tabs.ts),
 * each with her sections; the region and the period in the address go with every tab. ONE schools read serves
 * every tab and is not repeated when she changes tab; the coaching numbers are their own read (PLAN v6 §3), made
 * only for the Overview and the Coaching tab and kept for the same window and region.
 *
 * Scores (FICO / HITL) as %, everything else a count with "x of N" (operator, 2026-10-14). No bands, no thresholds.
 *
 * Who may see it is decided by the server (requireAnalyticsViewer, 403 otherwise) and, for routing, by the one rule
 * in lib/homeRoute (analytics/AnalyticsOnlyGuard sends anyone else to their own home). Nothing here is fetched
 * until the signed-in user is known to be an analytics-only account.
 */
type Status = 'loading' | 'ready' | 'refetching' | 'forbidden' | 'error';

const statusOf = (err: unknown) => ((err as { response?: { status?: number } })?.response?.status === 403 ? 'forbidden' : 'error');

const SchoolsAnalytics = () => {
  const { user, loading, logout } = useAuth();
  const c = analyticsCopy(useLang());
  const { tab: tabParam } = useParams();
  const { search } = useLocation();
  const view = useSchoolsView();
  const phone = useIsMobile();
  const [data, setData] = useState<SchoolsAnalyticsResponse | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const hasData = useRef(false);

  const allowed = !loading && isAnalyticsOnly(user);
  const unknownTab = tabParam !== undefined && !isSchoolsTab(tabParam);
  const tab: SchoolsTab = tabParam !== undefined && isSchoolsTab(tabParam) ? tabParam : 'overview';
  const region = regionParam(view.region);

  useEffect(() => {
    if (!allowed || unknownTab) return;
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
        setStatus(statusOf(err));
      });
    return () => { alive = false; };
  }, [allowed, unknownTab, view.from, view.to, region, attempt]);

  // The coaching read: only where it is shown, once per window and region (switching between the Overview and the
  // Coaching tab does not read it again).
  const needsCoaching = COACHING_TABS.includes(tab);
  const coachingKey = `${view.from ?? ''}|${view.to ?? ''}|${region}`;
  const [coachingAttempt, setCoachingAttempt] = useState(0);
  const [coaching, setCoaching] = useState<{ key: string; status: CoachingState['status']; data: CoachingAnalyticsResponse | null } | null>(null);
  const coachingFor = useRef<string | null>(null);
  useEffect(() => {
    if (!allowed || unknownTab || !needsCoaching) return;
    const want = `${coachingKey}#${coachingAttempt}`;
    if (coachingFor.current === want) return;
    coachingFor.current = want;
    let alive = true;
    let done = false;
    setCoaching({ key: coachingKey, status: 'loading', data: null });
    analytics
      .getCoaching({ from: view.from, to: view.to, region })
      .then((d) => {
        done = true;
        if (alive) setCoaching({ key: coachingKey, status: 'ready', data: d });
      })
      .catch((err) => {
        done = true;
        if (alive) setCoaching({ key: coachingKey, status: statusOf(err), data: null });
      });
    return () => {
      alive = false;
      // Left before it answered: read it again next time it is needed.
      if (!done) coachingFor.current = null;
    };
  }, [allowed, unknownTab, needsCoaching, coachingKey, coachingAttempt, view.from, view.to, region]);
  const retryCoaching = useCallback(() => setCoachingAttempt((n) => n + 1), []);
  const coachingState: CoachingState = coaching && coaching.key === coachingKey
    ? { status: coaching.status, data: coaching.data, retry: retryCoaching }
    : { status: 'loading', data: null, retry: retryCoaching };

  if (!loading && !user) return <Navigate to="/portal/login" replace />;
  // Anyone else is sent to their own home by the guard around the routes; nothing of this page renders meanwhile.
  if (!loading && !isAnalyticsOnly(user)) return null;
  // Not one of the six tabs: the Overview, keeping the region and the period.
  if (unknownTab) return <Navigate to={{ pathname: SCHOOLS_PATH, search }} replace />;

  const frame = (body: ReactNode) => (
    <AnalyticsFrame c={c} name={user?.firstName} onLogout={logout} tab={tab} search={search} subtitle={tab === 'overview' ? c.lede : undefined}>
      {body}
    </AnalyticsFrame>
  );

  // Definitions only: they need no numbers, so they never wait for them.
  if (tab === 'info') return frame(<InfoTab c={c} />);

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
      <div aria-busy="true" aria-label={c.states.loading} className="flex flex-col gap-5">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[18px]" />)}
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>,
    );
  }

  const regions = data.regions ?? [];
  const lpOpensNote = startsBeforeLpOpens(view.from, data.lpOpensLoggedSince)
    ? c.loggedSince(shortDate(data.lpOpensLoggedSince, false, c.months))
    : null;
  const chosen = view.region ? regions.find((r) => r.region.toLowerCase() === view.region?.toLowerCase())?.region ?? view.region : null;
  const props: TabProps = {
    c, data: { ...data, regions, schools: data.schools ?? [] }, region: chosen, onRegion: view.setRegion, phone, lpOpensNote,
  };

  const body: Record<Exclude<SchoolsTab, 'info'>, ReactNode> = {
    overview: <OverviewTab {...props} coaching={coachingState} />,
    lp: <LpTab {...props} />,
    training: <TrainingTab {...props} />,
    observations: <ObservationsTab {...props} kind={view.obs} />,
    coaching: <CoachingTab {...props} coaching={coachingState} />,
  };

  return frame(
    <>
      {/* Her order on Observations: the Digital Coach / Human buttons above the filters. */}
      {tab === 'observations' ? <ObservationKindToggle c={c} kind={view.obs} onKind={view.setObs} /> : null}

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
        <p data-testid="scope-line" className="mb-5 text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">{chosen ?? c.filters.allRegions}</b>
          {` · ${c.scope.schools(count(data.overview.schools, c))} · ${windowText(view.from, view.to, c)}`}
        </p>
        {body[tab]}
      </div>
    </>,
  );
};

export default SchoolsAnalytics;
