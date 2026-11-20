import { useState, type ReactNode } from 'react';
import { HistoryList } from '../ui/HistoryList';
import { useKitCopy } from '../ui/useKitCopy';
import { useCopy, useLang } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { COACHING } from '../coaching/copy';
import { JOURNEY } from './copy';
import { groupByWeek, weekHeading, type JourneyStep } from './weeks';
import { stepRow } from './steps';

/** Weeks drawn at first and added by each Show more (spec §4: two weeks at a time, no request per tap). */
export const WEEKS_PER_PAGE = 2;

/**
 * My journey's list (spec §4, UX: HistoryList over HistoryRow lead="glyph"): Pakistan weeks newest first, each a
 * group of rows; Show more adds two weeks and goes when the stored steps end. `readOnly` (the team view): no line
 * opens anything. No step → the kit's empty card with `emptyLabel`, and `after` under it.
 */
export function JourneyList({ steps, now, readOnly = false, emptyLabel, after }: {
  steps: JourneyStep[]; now: number; readOnly?: boolean; emptyLabel?: string; after?: ReactNode;
}) {
  const J = useCopy(JOURNEY);
  const L = useCopy(LESSONS);
  const CO = useCopy(COACHING);
  const kit = useKitCopy();
  const lang = useLang();
  const [shown, setShown] = useState(WEEKS_PER_PAGE);
  const words = {
    J, gradeShort: kit.gradeShort, chapter: L.all.chapter, bands: CO.bands, lang,
    days: { today: L.days.today, yesterday: L.days.yesterday, weekdaysShort: kit.weekdaysShort },
  };
  const weeks = groupByWeek(steps);
  const groups = weeks.slice(0, shown).map((w) => ({
    day: weekHeading(w.start, now, J),
    items: w.steps.map((s) => stepRow(s, now, words, { readOnly })),
  }));
  return (
    <div data-testid="journey-list" className="flex flex-col gap-2.5">
      <HistoryList
        groups={groups}
        emptyLabel={emptyLabel}
        showMore={weeks.length > shown}
        onShowMore={() => setShown((n) => n + WEEKS_PER_PAGE)}
      />
      {groups.length === 0 ? after : null}
    </div>
  );
}
