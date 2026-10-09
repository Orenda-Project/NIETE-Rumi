import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { useCopy } from '../i18n';
import { dayName, pkToday } from '../lessons/days';
import { LESSONS } from '../lessons/copy';
import { LoadState } from '../lessons/LoadState';
import { teacherPath } from '../routes';
import { HistoryList, StatusChip } from '../ui';
import { CARD, LIST_CARD } from '../ui/styles';
import { COACHING } from '../coaching/copy';
import { SectionHeading } from '../coaching/parts';
import { ReportPage } from '../coaching/ReportPage';
import { loadVisitReports, loadVisits, reportGroups } from './api';
import { OBSERVATIONS } from './copy';
import { OBS_HOME } from './paths';

/**
 * bd-fmf24g.4 — the teacher v2 Observations page (v28 canvas Observations).
 *
 *   Next visit    her own next coach visit (GET /teacher/visits): the day, the slot, the coach, the school
 *   In progress   a coach's visit not sent to her yet: its stage only — the draft is the coach's
 *   Reports       the coach visits sent to her (GET /coaching-sessions, `observation` only), each opening
 *                 the shared report page (the same layout as a Digital Coach lesson's)
 *
 * bd-fmf24g.13.2 — every word in the page's language (useCopy): the page's own, the report bands (Digital
 * Coaching's) and the day names (Lesson Plans').
 */
export function ObservationsHomePage() {
  const C = useCopy(OBSERVATIONS);
  const { bands } = useCopy(COACHING);
  const { days } = useCopy(LESSONS);
  const [visitsLoad, retryVisits] = useLoad(() => loadVisits(), 'obs:visits');
  const [reportsLoad, retryReports] = useLoad(() => loadVisitReports(), 'obs:reports');
  const visits = dataOf(visitsLoad);
  const reports = dataOf(reportsLoad);
  const today = pkToday();
  const groups = useMemo(() => (reports ? reportGroups(reports, today, bands, days) : []), [reports, today, bands, days]);
  const next = visits?.next ?? null;

  return (
    <TeacherPage feature="observations" title={C.title} crumb={C.home} backTo={teacherPath('home')} testId="obs-home">
      <SectionHeading>{C.nextVisit}</SectionHeading>
      {visits ? (
        <section aria-label={C.nextVisit} className={cn(CARD, 'flex min-h-[76px] items-center gap-3 px-3 py-2.5')}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">
            <CalendarDays className="h-[22px] w-[22px]" aria-hidden="true" />
          </span>
          {next ? (
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[17px] font-semibold">{[dayName(next.date, today, days), next.slot].filter(Boolean).join(' · ')}</span>
              <span className="truncate text-[13px] text-[#6b7280]">{[next.coachName, next.schoolName].filter(Boolean).join(' · ')}</span>
            </span>
          ) : (
            <span className="flex-1 text-[16px] font-semibold text-[#6b7280]">{C.noVisit}</span>
          )}
        </section>
      ) : (
        <LoadState status={visitsLoad.status} empty={false} onRetry={retryVisits} />
      )}

      {visits && visits.inProgress.length ? (
        <>
          <SectionHeading>{C.inProgress}</SectionHeading>
          <ul aria-label={C.inProgress} className={cn(LIST_CARD, 'm-0 list-none p-0')}>
            {visits.inProgress.map((v, i) => (
              <li key={v.sessionId} className={cn('flex min-h-[68px] items-center gap-3 px-3.5 py-2', i > 0 && 'border-t border-[#f0f1f3]')}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[16px] font-semibold">{C.coachVisit}</span>
                  <span className="truncate text-[13px] text-[#6b7280]">{[dayName(v.date, today, days), v.coachName].filter(Boolean).join(' · ')}</span>
                </span>
                <StatusChip text={C.stages[v.stage]} tone="waiting" />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="mt-3">
        {reports ? (
          <HistoryList heading={C.reports} groups={groups} showMore={false} emptyLabel={C.noReports} />
        ) : (
          <LoadState status={reportsLoad.status} empty={false} onRetry={retryReports} />
        )}
      </div>
    </TeacherPage>
  );
}

/** A coach visit's report: the shared report page, with Observations (in the page's language) as its way back. */
export function ObservationReportPage() {
  const C = useCopy(OBSERVATIONS);
  return <ReportPage backTo={OBS_HOME} crumb={C.title} />;
}
