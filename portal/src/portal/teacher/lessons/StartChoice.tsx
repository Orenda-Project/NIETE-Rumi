import { Plus } from 'lucide-react';
import { FEATURE_HUE } from '../icons';
import { useCopy } from '../i18n';
import { LESSONS } from './copy';
import { OWN } from './own/copy';
import { LESSONS_NEW } from './paths';
import { useLessonsLeader } from './audience';
import { useLpMakeOwn } from './own/flag';
import { OwnHomeCard } from './own/OwnHomeCard';
import { StartCard } from './StartCard';

/**
 * bd-snkn32.39 — the top of the Lesson Plans main page (testers, 13 Nov: "the first screen should clearly separate
 * ready-made lesson plans from Make my own"). With Make my own on for a teacher: two separate cards in one named group,
 * each with a one-line explanation — Ready-made lesson plans (grade and subject, today's path) and Make my own (its
 * own start, OwnHomeCard). Off, unknown, or a leader: today's single "+ New lesson plan" card, exactly as before.
 */
export function StartChoice() {
  const L = useCopy(LESSONS);
  const O = useCopy(OWN);
  const on = useLpMakeOwn();
  const leader = useLessonsLeader();
  const plus = <Plus className="h-[30px] w-[30px]" aria-hidden="true" />;
  if (on !== true || leader) {
    return <StartCard to={LESSONS_NEW} glyph={plus} hue={FEATURE_HUE.lessons} title={L.newLessonPlan} chip={L.allGrades} />;
  }
  return (
    <section role="group" aria-label={O.chooseOne} className="flex flex-col gap-3">
      <div data-testid="start-ready">
        <StartCard to={LESSONS_NEW} glyph={plus} hue={FEATURE_HUE.lessons} title={O.readyMade} hint={O.readyMadeHint} chip={L.allGrades} />
      </div>
      <OwnHomeCard />
    </section>
  );
}
