import { PencilLine } from 'lucide-react';
import type { LpLesson } from '../../../newui/lessons/lessonPlansApi';
import { ListRow } from '../../ui';
import { useCopy } from '../../i18n';
import { useLessonsLeader } from '../audience';
import { OWN } from './copy';
import { ownUrl } from './state';
import { useLpMakeOwn } from './api';

/**
 * bd-snkn32 — "Make my own" on a chapter's page. bd-oitowp (operator, 9 Nov: "at the top, not scrolling to the bottom,
 * it'll be missed then"): the FIRST thing under the steps, a card of its own above the ready plans, no heading; the
 * product reviewer's call: the kit's card row, pencil lead, no colour (indigo means selected, green primary/done). Drawn only when it can work: lpMakeOwn on for her (the shared, cached /config read: no extra
 * request), a teacher (a leader reading the page never sees it), and a grades 6–12 chapter with a lesson to start from.
 * Otherwise nothing at all, so the page is exactly today's.
 */
export function OwnRow({ at, list }: { at: { grade: number; subject: string; chapter: string }; list: LpLesson[] }) {
  const C = useCopy(OWN);
  const on = useLpMakeOwn();
  const leader = useLessonsLeader();
  if (on !== true || leader || !list.some((l) => l.lane === 'g612' && l.kind === 'lesson')) return null;
  return (
    <div data-testid="own-entry">
      <ListRow
        variant="card"
        glyph={<PencilLine className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
        label={C.makeMyOwn}
        subtitle={C.lessonPlanFive}
        to={ownUrl({ ...at, step: 'pages' })}
        testId="own-entry-row"
      />
    </div>
  );
}
