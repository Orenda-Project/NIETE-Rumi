import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { coach } from '../../services/api';
import { useCopy } from '../../teacher/i18n';
import { ChoiceChips, HistoryList, SelectField } from '../../teacher/ui';
import { ANALYTICS } from '../../teacher/analytics/copy';
import { RatingCard, TilesSection } from '../../teacher/analytics/sections';
import { bandTrend } from '../../teacher/analytics/model';
import { EmptyCard, SectionHeading } from '../../teacher/classes/parts';
import PeopleFrame, { LoadFailed } from '../people/PeopleFrame';
import { Loading, useLoad } from '../ui';
import { coachKpis, oneTeacherKpis, ratingChip, teacherPathOf, visibleTeachers } from './model';

export const COACH_ANALYTICS = '/portal/coach/analytics';
export const COACH_ANALYTICS_TEACHER = `${COACH_ANALYTICS}/teacher/:ext`;

/** Buttons first: up to six schools are chips, more are one picker (operator, 2026-10-09). */
const MAX_CHIPS = 6;

/**
 * bd-fmf24g.27 — the coach's Analytics (Analytics_C_People): her teachers across her schools, with a school filter.
 * Lifetime counts as the coach API serves them (no date range, no change pill); each row opens that teacher, and the
 * server only answers for a teacher in her own patch. No attendance, no area ratings: the server does not give a coach those.
 */
export function CoachAnalytics() {
  const C = useCopy(ANALYTICS);
  const { data, failed, reload } = useLoad(() => coach.getPeople(), []);
  const [school, setSchool] = useState('');
  const schools = useMemo(() => (data?.schools ?? []).map((s) => ({ key: s.schoolExtId, label: s.name || s.schoolExtId })), [data]);
  const teachers = useMemo(() => visibleTeachers(data?.teachers ?? [], school), [data, school]);
  const options = [{ key: '', label: C.allSchools }, ...schools];

  return (
    <PeopleFrame title={C.title} crumb={C.more} backTo="/portal/coach/more" feature="reports">
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          {schools.length > 1 && (schools.length <= MAX_CHIPS ? (
            <ChoiceChips label={C.school} options={options} value={school} onChange={setSchool} />
          ) : (
            <SelectField label={C.school} title={C.school} value={school} options={options.map((o) => ({ value: o.key, label: o.label }))} onChange={setSchool} />
          ))}
          <TilesSection heading={C.activity} items={coachKpis(teachers, C)} />
          {teachers.length ? (
            <HistoryList
              heading={C.teachers}
              showMore={false}
              groups={[{
                day: '',
                items: teachers.map((t) => ({
                  lead: 'person' as const,
                  title: t.name,
                  extra: [t.schoolName, C.teacherCounts(t.hitl, t.dc)].filter(Boolean).join(' · '),
                  chip: ratingChip(t.avgHitl, C),
                  to: teacherPathOf(t.teacherExtId as string),
                })),
              }]}
            />
          ) : (<><SectionHeading>{C.teachers}</SectionHeading><EmptyCard>{C.noTeachers}</EmptyCard></>)}
        </>
      )}
    </PeopleFrame>
  );
}

/** One of her teachers; the API answers 404 for anyone else, shown as Not found. */
export function CoachTeacherAnalytics() {
  const C = useCopy(ANALYTICS);
  const { ext = '' } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getTeacher(ext), [ext]);
  const isoDay = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return C.day(d, m - 1); };
  const trend = bandTrend(
    (data?.history ?? []).filter((h) => h.kind === 'HITL' && h.score != null && h.date).map((h) => ({ date: String(h.date).slice(0, 10), percentage: h.score as number, points: null, maxPoints: null, teacherName: null })),
    C,
  );
  return (
    <PeopleFrame title={data?.teacher.name || C.teachers} crumb={C.title} backTo={COACH_ANALYTICS} feature="reports">
      {failed && <EmptyCard>{C.notFound}</EmptyCard>}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <TilesSection heading={C.activity} items={oneTeacherKpis(data.teacher, C)} />
          {trend.length ? <RatingCard trend={trend} C={C} dateLabel={isoDay} /> : null}
        </>
      )}
    </PeopleFrame>
  );
}
