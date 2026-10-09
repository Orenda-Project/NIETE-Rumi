import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { portal } from '../../services/api';
import { getProgress, type ProgressCounts } from '../../newui/home/progressApi';
import { DEFAULT_RANGE, pkToday, type DateRange } from '../../newui/range';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { FeatureGlyph, type TeacherFeature } from '../icons';
import { DateRangeBar, Tabs } from '../ui';
import { useAuth } from '../../hooks/useAuth';
import { resolveRole } from '../../lib/leaderRole';
import { SchoolView } from './SchoolView';
import { useKitCopy } from '../ui/useKitCopy';
import { useCopy } from '../i18n';
import { resolveRange } from '../ui/range';
import { CARD, CHEVRON, FOCUS, ROW_DIVIDER } from '../ui/styles';
import { LESSONS_ALL } from '../lessons/paths';
import { COACHING_ALL } from '../coaching/paths';
import { LoadState } from '../classes/parts';
import { AreasCard, AttendanceCard, RatingCard, RemarksCard, TilesSection } from './sections';
import { ANALYTICS } from './copy';
import {
  activityKpis, areaRows, bandTrend, observationKpis, presenceRows, previousRange, remarkItems,
} from './model';


function Section({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-label={label} className="flex flex-col gap-2.5">{children}</section>;
}

function SeeAllRow({ to, label, glyph, first }: { to: string; label: string; glyph: TeacherFeature; first: boolean }) {
  return (
    <Link to={to} className={cn('flex min-h-[64px] items-center gap-3 px-3 text-[16px] font-semibold', !first && ROW_DIVIDER, FOCUS)}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[#33374a]">
        <FeatureGlyph name={glyph} size={22} />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} aria-hidden="true" />
    </Link>
  );
}

/**
 * bd-fmf24g.8 / bd-fmf24g.27 — Analytics (v28 canvas, A centred), from More. The existing answers only:
 *
 *   DateRangeBar        This month by default; every section follows it
 *   Activity, Observations   GET /progress (Home's counts) for the range and the period before, so each tile carries
 *                       its change; the tiles wear their feature, centred (Lesson Plans, Courses done, Assessments,
 *                       Attendance days; Coach Observations, Digital Coaching)
 *   See all             → All lesson plans, All Digital Coaching
 *   Rating over time    GET /my-analytics scoreTrend (Human observations) on BAND rows, never numbers
 *   Strongest → weakest the STEPS areas, the weakest marked Focus
 *   Attendance          her own days and her students' presence, as percentages
 *   Principal remarks   the quarterly remarks she received
 *
 * `MeAnalytics` is the body (no page frame) so a principal's "Me" tab shows exactly this.
 */
export function MeAnalytics() {
  const C = useCopy(ANALYTICS);
  const kit = useKitCopy();
  const isoDay = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number);
    return C.day(d, m - 1);
  };
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const dates = useMemo(() => {
    const r = resolveRange(range, pkToday(), kit.months);
    return { ...r, compareLabel: r.prevSpan ? kit.compareWith(r.prevSpan) : '' };
  }, [range, kit]);
  const before = useMemo(() => previousRange(dates), [dates]);
  const rangeKey = JSON.stringify([range, dates.from, dates.to]);

  const [progress, retryProgress] = useLoad(async () => {
    const [cur, prev] = await Promise.all([
      getProgress(range),
      before ? getProgress(before).catch(() => null) : Promise.resolve(null),
    ]);
    return { cur, prev } as { cur: ProgressCounts; prev: ProgressCounts | null };
  }, `progress:${rangeKey}`);
  const [mine, retryMine] = useLoad(() => portal.getMyAnalytics({ from: dates.from, to: dates.to }), `mine:${rangeKey}`);

  const p = dataOf(progress);
  const m = dataOf(mine);
  const trend = bandTrend(m?.analytics?.scoreTrend, C);
  const areas = areaRows(m?.analytics?.areas, C);
  const presence = presenceRows(m?.presence);
  const remarks = remarkItems(m?.remarksReceived, C);

  return (
    <>
      <DateRangeBar value={range} onChange={(r) => setRange(r)} />

      {p ? (
        <>
          <TilesSection heading={C.activity} items={activityKpis(p.cur, p.prev, C)} />
          <TilesSection heading={C.observationsHeading} items={observationKpis(p.cur, p.prev, C)} />
          <nav aria-label={C.title} className={cn(CARD, 'overflow-hidden')}>
            <SeeAllRow to={LESSONS_ALL} label={C.allLessonPlans} glyph="lessons" first />
            <SeeAllRow to={COACHING_ALL} label={C.allDigitalCoaching} glyph="coaching" first={false} />
          </nav>
        </>
      ) : (
        <LoadState status={progress.status} onRetry={retryProgress} label={C.loading} />
      )}

      {m ? (
        <>
          <RatingCard trend={trend} C={C} dateLabel={isoDay} />
          <AreasCard areas={areas} C={C} />
          <AttendanceCard presence={presence} firstLabel={C.youWerePresent} C={C} />
          <RemarksCard remarks={remarks} C={C} />
        </>
      ) : (
        <LoadState status={mine.status} onRetry={retryMine} label={C.loading} />
      )}
    </>
  );
}

/**
 * A teacher sees Me. A principal sees "My school | Me", My school first (operator, 2026-10-10); whether she is a
 * principal is her role; the school itself is never chosen here (the server reads it from her session).
 */
export function AnalyticsPage() {
  const C = useCopy(ANALYTICS);
  const { user } = useAuth();
  const principal = resolveRole(user) === 'principal';
  const [tab, setTab] = useState<'school' | 'me'>('school');
  return (
    <TeacherPage crumb={C.more} title={C.title} backTo={teacherPath('more')} feature="reports">
      {principal ? (
        <>
          <Tabs label={C.title} value={tab} onChange={(k) => setTab(k === 'me' ? 'me' : 'school')} tabs={[{ key: 'school', label: C.mySchool }, { key: 'me', label: C.me }]} />
          {tab === 'school' ? <SchoolView /> : <MeAnalytics />}
        </>
      ) : <MeAnalytics />}
    </TeacherPage>
  );
}
