import { BookOpen, Target } from 'lucide-react';
import { useCopy } from '../../i18n';
import { StartCard } from '../StartCard';
import { GOAL } from './goalCopy';
import { OWN_BOOK, OWN_GOAL } from './state';
import { RecentOwnPlans } from './RecentOwnPlans';

/** Neutral glyphs: no colour means "selected" here (the own card's rule, OwnHomeCard). */
const HUE = { bg: '#f3f4f6', fg: '#374151' } as const;

/**
 * bd-snkn32.58.1 (queue #155 A) — Make my own's first screen when the goal switch is on (Amena 19 Nov: "From textbook
 * chapter OR Start from a learning goal"): two equal cards, the same StartCard as the Lesson Plans main page, then her
 * own plans. The book card is today's flow; the goal card asks only for her class, then her goal.
 */
export function OwnStartChoice() {
  const G = useCopy(GOAL);
  return (
    <div className="flex flex-col gap-3" data-testid="own-start-choice">
      <div data-testid="own-start-book">
        <StartCard to={OWN_BOOK} glyph={<BookOpen className="h-[28px] w-[28px]" strokeWidth={2} aria-hidden="true" />} hue={HUE} title={G.fromBook} hint={G.fromBookHint} />
      </div>
      <div data-testid="own-start-goal">
        <StartCard to={OWN_GOAL} glyph={<Target className="h-[28px] w-[28px]" strokeWidth={2} aria-hidden="true" />} hue={HUE} title={G.fromGoal} hint={G.fromGoalHint} />
      </div>
      <RecentOwnPlans />
    </div>
  );
}
