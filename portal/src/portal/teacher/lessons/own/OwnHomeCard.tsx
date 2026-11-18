import { PencilLine } from 'lucide-react';
import { useCopy } from '../../i18n';
import { useLessonsLeader } from '../audience';
import { StartCard } from '../StartCard';
import { OWN } from './copy';
import { OWN_START } from './state';
import { useLpMakeOwn } from './flag';

/** No colour on the own glyph (bd-oitowp, the product reviewer: indigo means selected, green primary/done). */
const OWN_HUE = { bg: '#f3f4f6', fg: '#374151' } as const;

/**
 * bd-snkn32.25 — "Make my own" on the Lesson Plans main page (tester, 12 Nov: its own option, not only inside a
 * chapter). It starts at grade and subject in own mode (OWN_START): her class, then a chapter, then straight into the
 * Make my own steps. bd-snkn32.39 — the first screen's second choice (StartChoice): a big card the same size as
 * Ready-made lesson plans, with its one-line explanation. Drawn only for a teacher with lpMakeOwn on; otherwise
 * nothing, so the page is exactly today's.
 */
export function OwnHomeCard() {
  const C = useCopy(OWN);
  const on = useLpMakeOwn();
  const leader = useLessonsLeader();
  if (on !== true || leader) return null;
  return (
    <div data-testid="own-home">
      <div data-testid="start-own">
        <StartCard
          to={OWN_START}
          glyph={<PencilLine className="h-[28px] w-[28px]" strokeWidth={2} aria-hidden="true" />}
          hue={OWN_HUE}
          title={C.makeMyOwn}
          hint={C.makeOwnHint}
        />
      </div>
    </div>
  );
}
