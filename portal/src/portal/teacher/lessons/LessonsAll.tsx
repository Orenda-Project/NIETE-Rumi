import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { loadGradeSubjects } from '../../lib/gradeSubjects';
import { DEFAULT_RANGE, pkToday, type DateRange } from '../../newui/range';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { DateRangeBar, GradeSubjectPicker, HistoryList, KpiTiles, type GradeSubjectPair, type TeacherUiCopy } from '../ui';
import { useKitCopy } from '../ui/useKitCopy';
import { resolveRange } from '../ui/range';
import { FOCUS, OUTLINE_WIDE } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import { LoadState } from './LoadState';
import TeacherPage from '../TeacherPage';
import { groupByDay, kpiItems, loadLessonHistory, type ClassFilter } from './lessonHistory';
import { LESSONS_HOME } from './paths';

/**
 * bd-fmf24g.3 — All lesson plans (v28 canvas LessonsAll), from Recent's See all.
 *
 *   DateRangeBar      This month by default; the API is asked for exactly the dates it shows and the
 *                     period before it compares with, so the ▲▼ match the "vs …" under the tiles
 *   Filter by class   her classes with lesson plans (the pairs Select your class shows); Show all classes
 *                     clears it. The numbers AND the list narrow together, server-side.
 *   KpiTiles          Lesson plans (with its trend), Classes covered, Sent on WhatsApp, Days active
 *   the list          every plan in the range by Pakistan day, each reopening by key
 *
 * Every number is the server's count (GET /lesson-plans/history, dashboard lp-history.service).
 */

/** The dates a range covers and the period before it — what DateRangeBar reports on a change. */
function datesOf(range: DateRange, kit: TeacherUiCopy) {
  const r = resolveRange(range, pkToday(), kit.months);
  return { from: r.from, to: r.to, prevFrom: r.prevFrom, prevTo: r.prevTo, compareLabel: r.prevSpan ? kit.compareWith(r.prevSpan) : '' };
}

export function LessonsAllPage() {
  const C = useCopy(LESSONS);
  const kit = useKitCopy();
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [pair, setPair] = useState<GradeSubjectPair | null>(null);
  const [combos] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');

  const mine = useMemo(
    () => (dataOf(combos) ?? []).filter((c) => c.available === true && c.grade != null),
    [combos],
  );
  const filter: ClassFilter = useMemo(() => {
    if (!pair) return null;
    const c = mine.find((x) => x.grade === pair.grade && x.subject === pair.subject);
    return c ? { grade: c.grade, subjectKey: c.subjectKey } : null;
  }, [pair, mine]);

  const dates = useMemo(() => datesOf(range, kit), [range, kit]);
  const key = JSON.stringify([dates.from, dates.to, dates.prevFrom, dates.prevTo, filter]);
  const [history, retry] = useLoad(() => loadLessonHistory(dates, filter), key);
  const h = dataOf(history);
  const groups = useMemo(() => (h ? groupByDay(h.items, pkToday(), C) : []), [h, C]);

  return (
    <TeacherPage feature="lessons" crumb={C.title} title={C.all.title} backTo={LESSONS_HOME}>
      <DateRangeBar value={range} onChange={(r) => setRange(r)} />
      {mine.length ? (
        <>
          <GradeSubjectPicker label={C.all.filterLabel} combos={mine} allowOther={false} value={pair} onChange={setPair} />
          {pair ? (
            <button type="button" onClick={() => setPair(null)} className={cn(OUTLINE_WIDE, FOCUS)}>
              {C.all.showAllClasses}
            </button>
          ) : null}
        </>
      ) : null}
      {h ? (
        <>
          <KpiTiles items={kpiItems(h, C)} compareLabel={dates.compareLabel} />
          <HistoryList heading="" groups={groups} showMore={false} emptyLabel={C.all.empty} />
        </>
      ) : (
        <LoadState status={history.status} empty={false} onRetry={retry} />
      )}
    </TeacherPage>
  );
}
