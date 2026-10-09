import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { leader } from '../../services/api';
import type { SchoolAnalyticsResponse } from '../../types/portal';
import { DEFAULT_RANGE, pkToday, type DateRange } from '../../newui/range';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { useCopy } from '../i18n';
import { DateRangeBar, HistoryList } from '../ui';
import { useKitCopy } from '../ui/useKitCopy';
import { resolveRange } from '../ui/range';
import { EmptyCard, LoadState, SectionHeading } from '../classes/parts';
import { ANALYTICS } from './copy';
import { ANALYTICS_HOME } from './paths';
import { areaRows, bandTrend, presenceRows } from './model';
import { schoolKpis, teacherRows } from './school';
import { AreasCard, AttendanceCard, RatingCard, TilesSection } from './sections';

/**
 * bd-fmf24g.27 — the principal's "My school" view and the one-teacher page (Analytics_P_School, Analytics_P_One).
 *
 * The school is ALWAYS her own: the server reads it from her session (`GET /leader/school-analytics`); this page sends
 * a date window and, for one teacher, her id, which the server checks against the same school (404 otherwise). There
 * is no school parameter to send.
 *
 *   range       DateRangeBar (This month first); the change on each tile is a second call for the period before
 *   tiles       Lesson Plans, Assessments, Coach Observations, Digital Coaching, as the server counts them
 *   Teachers    her school's teachers as person rows (lifetime counts); a row opens that teacher
 *   cards       Rating over time, Strongest to weakest, Attendance (Teachers, Students)
 */

function useRange() {
  const kit = useKitCopy();
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const dates = useMemo(() => resolveRange(range, pkToday(), kit.months), [range, kit]);
  const before = dates.prevFrom && dates.prevTo ? { from: dates.prevFrom, to: dates.prevTo } : null;
  return { range, setRange, dates, before, key: JSON.stringify([range, dates.from, dates.to]) };
}

function Cards({ data }: { data: SchoolAnalyticsResponse }) {
  const C = useCopy(ANALYTICS);
  const isoDay = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return C.day(d, m - 1); };
  return (
    <>
      <RatingCard trend={bandTrend(data.analytics?.scoreTrend, C)} C={C} dateLabel={isoDay} />
      <AreasCard areas={areaRows(data.analytics?.areas, C)} C={C} />
      <AttendanceCard presence={presenceRows(data.presence)} firstLabel={C.teachers} C={C} />
    </>
  );
}

export function SchoolView() {
  const C = useCopy(ANALYTICS);
  const r = useRange();
  const [school, retrySchool] = useLoad(async () => {
    const [cur, prev] = await Promise.all([
      leader.getSchoolAnalytics(null, { from: r.dates.from, to: r.dates.to }),
      r.before ? leader.getSchoolAnalytics(null, r.before).catch(() => null) : Promise.resolve(null),
    ]);
    return { cur, prev };
  }, `school:${r.key}`);
  const [roster, retryRoster] = useLoad(() => leader.getTeachers(), 'roster');
  const s = dataOf(school);
  const rows = teacherRows(dataOf(roster)?.teachers, C);

  return (
    <>
      {s?.cur.school?.name ? (
        <p className="mx-1 text-[14px] font-semibold text-[#4b5563]">{s.cur.school.name} · {C.teachersN(s.cur.school.totalTeachers)}</p>
      ) : null}
      <DateRangeBar value={r.range} onChange={(x) => r.setRange(x)} />
      {s ? (
        <>
          <TilesSection heading={C.mySchool} items={schoolKpis(s.cur, s.prev, C)} />
          <section aria-label={C.teachers} className="flex flex-col gap-2.5">
            {dataOf(roster) ? (
              rows.length ? (
                <HistoryList
                  heading={C.teachers}
                  showMore={false}
                  groups={[{ day: '', items: rows.map((t) => ({ lead: 'person' as const, title: t.name, extra: t.extra, to: t.to })) }]}
                />
              ) : (<><SectionHeading>{C.teachers}</SectionHeading><EmptyCard>{C.noTeachers}</EmptyCard></>)
            ) : <LoadState status={roster.status} onRetry={retryRoster} label={C.loading} />}
          </section>
          <Cards data={s.cur} />
        </>
      ) : (
        <LoadState status={school.status} onRetry={retrySchool} label={C.loading} />
      )}
    </>
  );
}

/** One teacher of her school, by the id in the address; the server answers 404 for anyone outside it. */
export function OneTeacherPage() {
  const C = useCopy(ANALYTICS);
  const { id } = useParams<{ id: string }>();
  const r = useRange();
  const [one, retry] = useLoad(async () => {
    const [cur, prev] = await Promise.all([
      leader.getSchoolAnalytics(id, { from: r.dates.from, to: r.dates.to }),
      r.before ? leader.getSchoolAnalytics(id, r.before).catch(() => null) : Promise.resolve(null),
    ]);
    return { cur, prev };
  }, `one:${id}:${r.key}`);
  const o = dataOf(one);
  const title = o?.cur.focusTeacher?.name || C.teachers;

  return (
    <TeacherPage crumb={C.title} title={title} backTo={ANALYTICS_HOME} feature="reports">
      <DateRangeBar value={r.range} onChange={(x) => r.setRange(x)} />
      {o ? (
        <>
          <TilesSection heading={C.activity} items={schoolKpis(o.cur, o.prev, C)} />
          <Cards data={o.cur} />
        </>
      ) : one.status === 'error' ? (
        <EmptyCard>{C.notFound}</EmptyCard>
      ) : (
        <LoadState status={one.status} onRetry={retry} label={C.loading} />
      )}
    </TeacherPage>
  );
}
