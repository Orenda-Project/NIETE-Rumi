import { useMemo } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { BarChart3, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { FEATURE_HUE } from '../icons';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { HistoryList, HistoryRow } from '../ui';
import { CARD, FOCUS, LIST_CARD } from '../ui/styles';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { lessonGroups, loadDcHistory } from './api';
import { COACHING } from './copy';
import { readPrefill } from './draft';
import { COACHING_ALL, COACHING_NEW } from './paths';

/**
 * The teacher v2 Digital Coaching main page, in Assessment's shape (design v6, the hub template of 12 Oct):
 *
 *   Start DC observation   the + card → the one screen (NewObservation): Grade and subject, Recording, Lesson plan,
 *                          Photos, Submit, then its progress there.
 *   Summary                her DC observations in all → All DC Observations.
 *   Analysing              only while a lesson is being analysed (GET /teacher/coaching/history: no report yet, no
 *                          band); each opens its lesson, where she answers the reflection question.
 *   Recent DC Observations the newest four with a report or band, open, no See all.
 *
 * Opened from a lesson plan (Start DC observation, ?grade&subject&plan) she goes straight to the one screen with it.
 */

const RECENT_COUNT = 4;

export function CoachingHomePage() {
  const C = useCopy(COACHING);
  const { days } = useCopy(LESSONS);
  const location = useLocation();
  const prefill = useMemo(() => readPrefill(location.search), [location.search]);
  const [history] = useLoad(() => loadDcHistory({ range: 'all' }), 'dc:history');

  const items = useMemo(() => dataOf(history)?.items ?? [], [history]);
  const analysing = useMemo(() => items.filter((it) => !it.reportReady && it.percentage == null), [items]);
  const done = useMemo(() => items.filter((it) => it.reportReady || it.percentage != null).slice(0, RECENT_COUNT), [items]);
  const making = useMemo(() => lessonGroups(analysing, undefined, C, days).flatMap((g) => g.items), [analysing, C, days]);
  const groups = useMemo(() => lessonGroups(done, undefined, C, days), [done, C, days]);
  const total = dataOf(history)?.total;

  if (prefill.pick || prefill.grade != null) return <Navigate to={`${COACHING_NEW}${location.search}`} replace />;

  return (
    <TeacherPage feature="coaching" title={C.title} crumb={C.home} backTo={teacherPath('home')} testId="dc-home">
      <Link to={COACHING_NEW} className={cn('flex min-h-[112px] items-center gap-4 p-4', CARD, FOCUS)}>
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
          style={{ background: FEATURE_HUE.coaching.bg, color: FEATURE_HUE.coaching.fg }}
        >
          <Plus className="h-[30px] w-[30px]" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <b className="text-[20px] font-semibold leading-tight">{C.startObservation}</b>
          <span className="inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">
            {C.subReport}
          </span>
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </Link>

      <Link to={COACHING_ALL} className={cn('flex min-h-[88px] items-center gap-4 px-4 py-3.5', CARD, FOCUS)}>
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[#f3f3f7] text-[#33374a]">
          <BarChart3 className="h-[26px] w-[26px]" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[20px] font-semibold leading-tight">{C.summary}</b>
          {/* A count that did not load is not shown (never a 0). */}
          {total != null ? <span className="text-[15px] text-[#4b5563]">{C.summaryCount(total)}</span> : null}
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </Link>

      {making.length > 0 ? (
        <>
          <h2 className="mx-1 mt-3 text-[22px] font-semibold leading-tight">{C.analysing}</h2>
          <section aria-label={C.analysing} className={LIST_CARD}>
            {making.map(({ id, ...row }, i) => <HistoryRow key={id ?? i} first={i === 0} {...row} />)}
          </section>
        </>
      ) : null}

      <div className="mt-3">
        <HistoryList heading={C.recent} groups={groups} showMore={false} emptyLabel={C.noneYet} />
      </div>
    </TeacherPage>
  );
}
