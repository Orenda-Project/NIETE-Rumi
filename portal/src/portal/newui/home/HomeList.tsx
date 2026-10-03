import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen, CalendarCheck, CalendarDays, CircleAlert, ClipboardList, Download, FlaskConical, GraduationCap, Inbox, Loader2,
} from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import type { BandKey } from '../../lib/scoreBands';
import type { AssessmentPaper } from '../../services/api';
import { ASSESSMENT_COPY, HOME_COPY } from '../copy';
import { InnerBar } from '../InnerBar';
import { List, Row } from '../List';
import { Chip, FilterChips, type ChipTone } from '../Chip';
import { DateRangeButton, DateRangeSheet } from '../DateRange';
import { Hero } from '../Hero';
import { BottomButton } from '../BottomButton';
import { pkDayMonth, rangeFromSearch, rangeSearch, shortDate, type DateRange } from '../range';
import { subjectIcon } from '../assessment/assessmentApi';
import { PaperSheet } from '../assessment/MyAssessments';
import { providerShort, trainingPaths } from '../training/trainingApi';
import {
  HOME_METRICS, countOf, getProgress, getProgressList, requestPlan612,
  type AssessmentMade, type AttendanceDay, type CoachingDone, type HomeMetric, type LessonPlanUsed, type ProgressCounts,
  type ProgressList, type TrainingDone,
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
 * bd-5rz1v.17.2 — the other three tiles' lists, which used to be other pages:
 *   training      "n modules"; a row per module done — the done tile, its title, the provider
 *                 (as teachers know it, trainingApi's providerShort) and the day. Tapping opens
 *                 the part in the new Training screens (/portal/training/unit/:id).
 *   assessments   "n made"; a row per paper — its subject's icon (neutral grey), "Science · Ch 2",
 *                 Grade and the day, a download icon. Tapping opens My assessments' paper sheet
 *                 (Download, Answer key when it has one). Not My assessments itself: that list is
 *                 one entry per paper family with no date filter, and this one is the papers the
 *                 tile counted in the range.
 *   attendance    "n days" "n registers"; a row per day — the date, each class as a chip, the
 *                 register count. Tapping opens that day on the Attendance tab of Analytics, the
 *                 existing attendance view.
 *
 * Loading: a spinner word. Failed: "Not loaded" and Try again. Empty: a small Hero, "Nothing yet".
 */

const METRICS: Record<HomeMetric, string> = {
  'lesson-plans': HOME_COPY.tiles.lessonPlans,
  coaching: HOME_COPY.tiles.coaching,
  training: HOME_COPY.tiles.training,
  assessments: HOME_COPY.tiles.assessments,
  attendance: HOME_COPY.tiles.attendance,
};

/** The empty Hero's icon: the list's own subject, in neutral grey. */
const EMPTY_ICON: Record<HomeMetric, LucideIcon> = {
  'lesson-plans': Inbox,
  coaching: Inbox,
  training: GraduationCap,
  assessments: ClipboardList,
  attendance: CalendarCheck,
};

const isMetric = (m: string | undefined): m is HomeMetric => (HOME_METRICS as readonly string[]).includes(m ?? '');

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
          : null}
        {metric === 'coaching'
          ? <Coaching range={range} state={state as State<'coaching'>} onPick={() => setPicking(true)} onRetry={retry} />
          : null}
        {metric === 'training'
          ? <Training range={range} state={state as State<'training'>} onPick={() => setPicking(true)} onRetry={retry} />
          : null}
        {metric === 'assessments'
          ? <Assessments range={range} state={state as State<'assessments'>} onPick={() => setPicking(true)} onRetry={retry} />
          : null}
        {metric === 'attendance'
          ? <Attendance range={range} state={state as State<'attendance'>} onPick={() => setPicking(true)} onRetry={retry} />
          : null}
      </div>
      <DateRangeSheet open={picking} value={range} onChange={onRange} onClose={() => setPicking(false)} />
    </PortalLayout>
  );
}

/** Loading / failed / empty, the same on every list. */
function NotAList({ state, empty, onRetry, emptyIcon = Inbox }: {
  state: State<HomeMetric>; empty: boolean; onRetry: () => void; emptyIcon?: LucideIcon;
}) {
  if (state.status === 'loading') return <Hero title={HOME_COPY.loading} icon={Loader2} spinning live />;
  if (state.status === 'error') {
    return (
      <>
        <Hero title={HOME_COPY.notLoaded} icon={CircleAlert} tone="error" live />
        <BottomButton tone="outline" onClick={onRetry}>{HOME_COPY.retry}</BottomButton>
      </>
    );
  }
  if (empty) return <Hero title={HOME_COPY.empty} icon={emptyIcon} />;
  return null;
}

/** The range on a light button, then the list's own counts as chips. */
function RangeRow({ range, onPick, children }: { range: DateRange; onPick: () => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangeButton value={range} surface="light" onClick={onPick} />
      {children}
    </div>
  );
}

/** "2 Oct": a moment's day in Pakistan. */
const pkShort = (iso: string | null | undefined): string | null => {
  const d = iso ? pkDayMonth(iso) : null;
  return d ? `${d.day} ${d.month}` : null;
};

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

/* ── Training modules done (bd-5rz1v.17.2) ──────────────────────────────────── */

function Training({ range, state, onPick, onRetry }: {
  range: DateRange; state: State<'training'>; onPick: () => void; onRetry: () => void;
}) {
  const ok = state.status === 'ok' ? state : null;
  const paths = trainingPaths();
  return (
    <>
      <RangeRow range={range} onPick={onPick}>
        {ok ? <Chip icon={GraduationCap}>{HOME_COPY.modules(ok.list.total)}</Chip> : null}
      </RangeRow>
      <NotAList state={state} empty={!ok?.list.items.length} onRetry={onRetry} emptyIcon={EMPTY_ICON.training} />
      {ok && ok.list.items.length ? (
        <List label={HOME_COPY.tiles.training}>
          {ok.list.items.map((m: TrainingDone) => {
            const when = pkShort(m.completedAt);
            return (
              <Row
                key={m.moduleId}
                tile="done"
                title={m.title || HOME_COPY.moduleFallback}
                to={paths.unit(m.moduleId)}
                chips={(
                  <>
                    {m.vendorKey ? <Chip>{providerShort(m.vendorKey, m.vendorName)}</Chip> : null}
                    {when ? <Chip>{when}</Chip> : null}
                  </>
                )}
              />
            );
          })}
        </List>
      ) : null}
    </>
  );
}

/* ── Assessments made (bd-5rz1v.17.2) ───────────────────────────────────────── */

/** The paper sheet takes My assessments' paper; this list's item says the same things. */
const asPaper = (a: AssessmentMade): AssessmentPaper => ({
  paper_id: a.paperId,
  grade: a.grade,
  subject_key: a.subjectKey ?? '',
  subject: a.subject ?? '',
  chapter_number: a.chapterNumber,
  question_count: a.questionCount,
  total_marks: a.totalMarks,
  ready_at: a.createdAt,
  has_answer_key: a.hasAnswerKey,
});

function Assessments({ range, state, onPick, onRetry }: {
  range: DateRange; state: State<'assessments'>; onPick: () => void; onRetry: () => void;
}) {
  const [open, setOpen] = useState<AssessmentPaper | null>(null);
  const ok = state.status === 'ok' ? state : null;
  return (
    <>
      <RangeRow range={range} onPick={onPick}>
        {ok ? <Chip icon={ClipboardList}>{HOME_COPY.made(ok.list.total)}</Chip> : null}
      </RangeRow>
      <NotAList state={state} empty={!ok?.list.items.length} onRetry={onRetry} emptyIcon={EMPTY_ICON.assessments} />
      {ok && ok.list.items.length ? (
        <List label={HOME_COPY.tiles.assessments}>
          {ok.list.items.map((a: AssessmentMade) => {
            const when = pkShort(a.createdAt);
            return (
              <Row
                key={a.paperId}
                icon={subjectIcon(a.subjectKey)}
                title={ASSESSMENT_COPY.paperName(a.subject, a.chapterNumber)}
                end={Download}
                onClick={() => setOpen(asPaper(a))}
                chips={(
                  <>
                    {a.grade != null ? <Chip>{HOME_COPY.grade(a.grade)}</Chip> : null}
                    {when ? <Chip>{when}</Chip> : null}
                  </>
                )}
              />
            );
          })}
        </List>
      ) : null}
      <PaperSheet paper={open} onClose={() => setOpen(null)} />
    </>
  );
}

/* ── Attendance marked (bd-5rz1v.17.2) ──────────────────────────────────────── */

/** That day on the existing attendance view: the Attendance tab of Analytics (lib/analyticsView). */
const attendanceDay = (date: string) => `/portal/coaching/analytics?from=${date}&to=${date}#attendance`;

function Attendance({ range, state, onPick, onRetry }: {
  range: DateRange; state: State<'attendance'>; onPick: () => void; onRetry: () => void;
}) {
  const ok = state.status === 'ok' ? state : null;
  const registers = countOf(ok?.counts?.attendance?.registers);
  return (
    <>
      <RangeRow range={range} onPick={onPick}>
        {ok ? <Chip icon={CalendarDays}>{HOME_COPY.days(ok.list.total)}</Chip> : null}
        {ok && registers !== null ? <Chip icon={CalendarCheck}>{HOME_COPY.registers(registers)}</Chip> : null}
      </RangeRow>
      <NotAList state={state} empty={!ok?.list.items.length} onRetry={onRetry} emptyIcon={EMPTY_ICON.attendance} />
      {ok && ok.list.items.length ? (
        <List label={HOME_COPY.tiles.attendance}>
          {ok.list.items.map((d: AttendanceDay) => (
            <Row
              key={d.date}
              icon={CalendarCheck}
              title={shortDate(d.date)}
              to={attendanceDay(d.date)}
              chips={(
                <>
                  {(d.classes || []).map((c) => <Chip key={c}>{c}</Chip>)}
                  <Chip>{HOME_COPY.registers(d.registers)}</Chip>
                </>
              )}
            />
          ))}
        </List>
      ) : null}
    </>
  );
}
