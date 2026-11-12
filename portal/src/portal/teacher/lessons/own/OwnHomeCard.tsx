import { PencilLine } from 'lucide-react';
import { ListRow } from '../../ui';
import { useCopy } from '../../i18n';
import { useLessonsLeader } from '../audience';
import { OWN } from './copy';
import { OWN_START } from './state';
import { useLpMakeOwn } from './flag';

/**
 * bd-snkn32.25 — "Make my own" on the Lesson Plans main page (tester, 12 Nov: its own option, not only inside a
 * chapter). The chapter page's card (OwnRow), the same look, but it starts at grade and subject in own mode
 * (OWN_START): her class, then a chapter, then straight into the Make my own steps. Drawn only for a teacher with
 * lpMakeOwn on; otherwise nothing, so the page is exactly today's.
 */
export function OwnHomeCard() {
  const C = useCopy(OWN);
  const on = useLpMakeOwn();
  const leader = useLessonsLeader();
  if (on !== true || leader) return null;
  return (
    <div data-testid="own-home">
      <ListRow
        variant="card"
        glyph={<PencilLine className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
        label={C.makeMyOwn}
        subtitle={C.lessonPlanFive}
        to={OWN_START}
        testId="own-home-row"
      />
    </div>
  );
}
