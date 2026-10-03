import { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, CalendarDays, CircleAlert, FlaskConical, Inbox, Loader2 } from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import type { BandKey } from '../../lib/scoreBands';
import { HOME_COPY } from '../copy';
import { InnerBar } from '../InnerBar';
import { List, Row } from '../List';
import { Chip, FilterChips, type ChipTone } from '../Chip';
import { DateRangeButton, DateRangeSheet } from '../DateRange';
import { Hero } from '../Hero';
import { BottomButton } from '../BottomButton';
import { pkDayMonth, rangeFromSearch, rangeSearch, type DateRange } from '../range';
import {
  countOf, getProgress, getProgressList, requestPlan612,
  type CoachingDone, type HomeMetric, type LessonPlanUsed, type ProgressCounts, type ProgressList,
} from './progressApi';

/**
 * bd-5rz1v.17 (UI half) — the lists behind Home's tiles, as pages inside Home (deep-screens.html:
 * "Lesson plans used", "Coaching & observations"): a light bar whose breadcrumb is Home, the same
 * date range on a light button, then the items from GET /api/portal/progress/:metric.
 *
 *   lesson-plans  "n plans" "n days"; a row per plan — the day she last used it (Pakistan time)
 *                 in the tile, its title, Grade / subject / month chips. Tapping opens it in the
 *                 portal's viewer; a 6-12 plan is asked for in its language first.
 *   coaching      filters All n · Digital Coach · Coach · Principal; a row per session — who,
 *                 the day, the band as a word (good green, average amber), the month. Tapping
 *                 opens the session. The only place on Home a rating appears.
 *
 * Loading: a spinner word. Failed: "Not loaded" and Try again. Empty: "Nothing yet".
 */

const METRICS: Record<HomeMetric, string> = {
  'lesson-plans': HOME_COPY.tiles.lessonPlans,
  coaching: HOME_COPY.tiles.coaching,
};

const isMetric = (m: string | undefined): m is HomeMetric => m === 'lesson-plans' || m === 'coaching';

type State<M extends HomeMetric> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; list: ProgressList<M>; counts: ProgressCounts | null };

function useHomeList<M extends HomeMetric>(metric: M, range: DateRange, key: string) {
  const [state, setState] = useState<State<M>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    Promise.all([getProgressList(metric, range), getProgress(range).catch(() => null)])
      .then(([list, counts]) => { if (live) setState({ status: 'ok', list, counts }); })
      .catch(() => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
    // `key` IS the range, as a string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, key, attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}

export default function HomeList() {
  const { metric } = useParams();
  const [params, setParams] = useSearchParams();
  const range = rangeFromSearch(params);
  const search = rangeSearch(range);
  if (!isMetric(metric)) return <Navigate to={`/portal/dashboard${search}`} replace />;
  return <ListPage key={metric} metric={metric} range={range} search={search} onRange={(next) => setParams(new URLSearchParams(rangeSearch(next)), { replace: true })} />;
}

function ListPage({ metric, range, search, onRange }: { metric: HomeMetric; range: DateRange; search: string; onRange: (r: DateRange) => void }) {
  const [picking, setPicking] = useState(false);
  const { state, retry } = useHomeList(metric, range, search);

  return (
    <PortalLayout ownHeading>
      <InnerBar feature="home" crumb={HOME_COPY.home} title={METRICS[metric]} backTo={`/portal/dashboard${search}`} />
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-[14px] pb-[14px] md:px-10">
        {metric === 'lesson-plans'
          ? <LessonPlans range={range} state={state as State<'lesson-plans'>} onPick={() => setPicking(true)} onRetry={retry} />
          : <Coaching range={range} state={state as State<'coaching'>} onPick={() => setPicking(true)} onRetry={retry} />}
      </div>
      <DateRangeSheet open={picking} value={range} onChange={onRange} onClose={() => setPicking(false)} />
    </PortalLayout>
  );
}

/** Loading / failed / empty, the same on every list. */
function NotAList({ state, empty, onRetry }: { state: State<HomeMetric>; empty: boolean; onRetry: () => void }) {
  if (state.status === 'loading') return <Hero title={HOME_COPY.loading} icon={Loader2} spinning live />;
  if (state.status === 'error') {
    return (
      <>
        <Hero title={HOME_COPY.notLoaded} icon={CircleAlert} tone="error" live />
        <BottomButton tone="outline" onClick={onRetry}>{HOME_COPY.retry}</BottomButton>
      </>
    );
  }
  if (empty) return <Hero title={HOME_COPY.empty} icon={Inbox} />;
  return null;
}

/* ── Lesson plans used ───────────────────────────────────────────────────── */

function LessonPlans({ range, state, onPick, onRetry }: {
  range: DateRange; state: State<'lesson-plans'>; onPick: () => void; onRetry: () => void;
}) {
  const ok = state.status === 'ok' ? state : null;
  const days = countOf(ok?.counts?.lessonPlans?.days);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeButton value={range} surface="light" onClick={onPick} />
        {ok ? <Chip icon={BookOpen}>{HOME_COPY.plans(ok.list.total)}</Chip> : null}
        {ok && days !== null ? <Chip icon={CalendarDays}>{HOME_COPY.days(days)}</Chip> : null}
      </div>
      <NotAList state={state} empty={!ok?.list.items.length} onRetry={onRetry} />
      {ok && ok.list.items.length ? (
        <List>
          {ok.list.items.map((p) => <PlanRow key={p.planKey} plan={p} />)}
        </List>
      ) : null}
    </>
  );
}

const SCIENCE = /science|physics|chemistry|biology/i;

function PlanRow({ plan }: { plan: LessonPlanUsed }) {
  const openPlan = useLessonPlanOpener();
  const [preparing, setPreparing] = useState(false);
  const title = plan.title || HOME_COPY.planFallback;
  const when = plan.lastUsedAt ? pkDayMonth(plan.lastUsedAt) : null;

  const open = useCallback(async () => {
    if (plan.open.lane === 'k5') {
      void openPlan({ lane: 'k5', lessonId: plan.open.lessonId, assetKind: 'lesson' }, title);
      return;
    }
    try {
      const r = await requestPlan612(plan.open.segmentId, plan.open.lang || 'en');
      if (r.ready && r.renderId) void openPlan({ lane: 'g612', renderId: r.renderId }, title);
      else setPreparing(true);
    } catch {
      setPreparing(true);
    }
  }, [openPlan, plan, title]);

  return (
    <Row
      title={title}
      lead={when?.day}
      onClick={plan.found ? open : undefined}
      chips={(
        <>
          {plan.grade != null ? <Chip>{HOME_COPY.grade(plan.grade)}</Chip> : null}
          {plan.subject ? <Chip icon={SCIENCE.test(plan.subject) ? FlaskConical : undefined}>{plan.subject}</Chip> : null}
          {when ? <Chip>{when.month}</Chip> : null}
          {preparing ? <Chip tone="waiting">{HOME_COPY.preparing}</Chip> : null}
        </>
      )}
    />
  );
}

/* ── Coaching & observations ─────────────────────────────────────────────── */

type CoachingFilter = 'all' | 'digital' | 'coach' | 'principal';

const BAND_TONE: Record<BandKey, ChipTone> = {
  excellent: 'done',
  good: 'done',
  average: 'waiting',
  below_average: 'waiting',
  needs_support: 'waiting',
};

const matches = (s: CoachingDone, f: CoachingFilter) =>
  f === 'all'
  || (f === 'digital' && s.kind === 'digital_coach')
  || (f !== 'digital' && s.kind === 'observation' && s.observerRole === f);

function whoDid(s: CoachingDone): string {
  if (s.kind === 'digital_coach') return HOME_COPY.rows.digitalCoach;
  if (s.observerRole === 'coach') return HOME_COPY.rows.coach;
  if (s.observerRole === 'principal') return HOME_COPY.rows.principal;
  return HOME_COPY.rows.other;
}

function Coaching({ range, state, onPick, onRetry }: {
  range: DateRange; state: State<'coaching'>; onPick: () => void; onRetry: () => void;
}) {
  const [filter, setFilter] = useState<CoachingFilter>('all');
  const ok = state.status === 'ok' ? state : null;
  const shown = ok ? ok.list.items.filter((s) => matches(s, filter)) : [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeButton value={range} surface="light" onClick={onPick} />
      </div>
      {ok && ok.list.items.length ? (
        <FilterChips<CoachingFilter>
          label={HOME_COPY.tiles.coaching}
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: HOME_COPY.filters.all(ok.list.total) },
            { key: 'digital', label: HOME_COPY.filters.digitalCoach },
            { key: 'coach', label: HOME_COPY.filters.coach },
            { key: 'principal', label: HOME_COPY.filters.principal },
          ]}
        />
      ) : null}
      <NotAList state={state} empty={!ok?.list.items.length} onRetry={onRetry} />
      {ok && shown.length ? (
        <List>
          {shown.map((s) => {
            const when = pkDayMonth(s.date);
            return (
              <Row
                key={s.id}
                title={whoDid(s)}
                lead={when?.day}
                to={`/portal/coaching/session/${s.id}`}
                chips={(
                  <>
                    {s.band ? <Chip tone={BAND_TONE[s.band]}>{HOME_COPY.bands[s.band]}</Chip> : null}
                    {when ? <Chip>{when.month}</Chip> : null}
                  </>
                )}
              />
            );
          })}
        </List>
      ) : null}
      {ok && ok.list.items.length && !shown.length ? <Hero title={HOME_COPY.empty} icon={Inbox} /> : null}
    </>
  );
}
