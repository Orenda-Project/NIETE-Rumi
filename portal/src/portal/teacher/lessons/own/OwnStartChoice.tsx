import { BookOpen, CalendarRange, Target } from 'lucide-react';
import { useCopy } from '../../i18n';
import { StartCard } from '../StartCard';
import { GOAL } from './goalCopy';
import { OWN_BOOK, OWN_GOAL } from './state';
import { RecentOwnPlans } from './RecentOwnPlans';
import { UNIT } from './unitCopy';
import { OWN_UNIT } from './unitPaths';
import { MyUnits } from './MyUnits';

/** Neutral glyphs: no colour means "selected" here (the own card's rule, OwnHomeCard). */
const HUE = { bg: '#f3f4f6', fg: '#374151' } as const;

/**
 * bd-snkn32.58.1 (queue #155 A) — Make my own's first screen when the goal switch is on (Amena 19 Nov: "From textbook
 * chapter OR Start from a learning goal"): two equal cards, the same StartCard as the Lesson Plans main page, then her
 * own plans. The book card is today's flow; the goal card asks only for her class, then her goal.
 */
/**
 * bd-snkn32.59.1 (queue #165) — `unit`: a third card, "A whole unit" (portal_lp_own_unit, list-only), and her units.
 * `goal` false (only the unit switch on): the goal card is not shown.
 */
export function OwnStartChoice({ goal = true, unit = false }: { goal?: boolean; unit?: boolean } = {}) {
  const G = useCopy(GOAL);
  const U = useCopy(UNIT);
  return (
    <div className="flex flex-col gap-3" data-testid="own-start-choice">
      <div data-testid="own-start-book">
        <StartCard to={OWN_BOOK} glyph={<BookOpen className="h-[28px] w-[28px]" strokeWidth={2} aria-hidden="true" />} hue={HUE} title={G.fromBook} hint={G.fromBookHint} />
      </div>
      {goal ? (
        <div data-testid="own-start-goal">
          <StartCard to={OWN_GOAL} glyph={<Target className="h-[28px] w-[28px]" strokeWidth={2} aria-hidden="true" />} hue={HUE} title={G.fromGoal} hint={G.fromGoalHint} />
        </div>
      ) : null}
      {unit ? (
        <div data-testid="own-start-unit">
          <StartCard to={OWN_UNIT} glyph={<CalendarRange className="h-[28px] w-[28px]" strokeWidth={2} aria-hidden="true" />} hue={HUE} title={U.wholeUnit} hint={U.wholeUnitHint} />
        </div>
      ) : null}
      <RecentOwnPlans />
      {unit ? <MyUnits /> : null}
    </div>
  );
}
