import { useMemo, useState } from 'react';
import { DEFAULT_RANGE, pkToday, type DateRange } from '../../newui/range';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { LoadState } from '../lessons/LoadState';
import { DateRangeBar, HistoryList, KpiTiles, type TeacherUiCopy } from '../ui';
import { useKitCopy } from '../ui/useKitCopy';
import { resolveRange } from '../ui/range';
import { dcKpiItems, historyParams, lessonGroups, loadDcHistory } from './api';
import { COACHING } from './copy';
import { COACHING_HOME } from './paths';

/**
 * bd-fmf24g.4 — All DC observations (v28 canvas CoachingAll), from Recent DC Observations' See all.
 *
 *   DateRangeBar   This month by default; the API is asked for exactly the dates shown and the period
 *                  before, so the ▲▼ match the "vs …" under the tiles
 *   KpiTiles       DC observations (with its trend), Latest band, Minutes recorded, Reports received —
 *                  the server's counts (GET /teacher/coaching/history); a band, never a number
 *   the list       every Digital Coach lesson in the range by Pakistan day, each opening its report
 *
 * bd-fmf24g.13.2 — every word in the page's language: the screen's (useCopy), the kit's "vs …" and months
 * (useKitCopy, as All lesson plans), the days (Lesson Plans' day names).
 */

function datesOf(range: DateRange, kit: TeacherUiCopy) {
  const r = resolveRange(range, pkToday(), kit.months);
  return {
    from: r.from, to: r.to, prevFrom: r.prevFrom, prevTo: r.prevTo,
    compareLabel: r.prevSpan ? kit.compareWith(r.prevSpan) : '',
  };
}

export function CoachingAllPage() {
  const C = useCopy(COACHING);
  const { days } = useCopy(LESSONS);
  const kit = useKitCopy();
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const dates = useMemo(() => datesOf(range, kit), [range, kit]);
  const key = JSON.stringify([dates.from, dates.to, dates.prevFrom, dates.prevTo]);
  const [history, retry] = useLoad(() => loadDcHistory(historyParams(dates)), `dc-all:${key}`);
  const h = dataOf(history);
  const groups = useMemo(() => (h ? lessonGroups(h.items, undefined, C, days) : []), [h, C, days]);

  return (
    <TeacherPage feature="coaching" crumb={C.title} title={C.allTitle} backTo={COACHING_HOME} testId="dc-all">
      <DateRangeBar value={range} onChange={(r) => setRange(r)} />
      {h ? (
        <>
          <KpiTiles items={dcKpiItems(h, C)} compareLabel={dates.compareLabel} />
          <HistoryList heading="" groups={groups} showMore={false} emptyLabel={C.noneInRange} />
        </>
      ) : (
        <LoadState status={history.status} empty={false} onRetry={retry} />
      )}
    </TeacherPage>
  );
}
