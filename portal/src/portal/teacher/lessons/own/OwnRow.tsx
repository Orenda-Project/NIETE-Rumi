import { PencilLine } from 'lucide-react';
import type { LpLesson } from '../../../newui/lessons/lessonPlansApi';
import { ListRow } from '../../ui';
import { LIST_CARD } from '../../ui/styles';
import { useCopy } from '../../i18n';
import { useLessonsLeader } from '../audience';
import { OWN } from './copy';
import { ownUrl } from './state';
import { useLpMakeOwn } from './api';

/**
 * bd-snkn32 — "Make my own" on a chapter's page: one more row under the ready-made plans, under "For your class" (the
 * flow draft, screen 2). Drawn only when it can work: lpMakeOwn on for her (the shared, cached /config read: no extra
 * request), a teacher (a leader reading the page never sees it), and a grades 6–12 chapter with a lesson to start from.
 * Otherwise nothing at all, so the page is exactly today's.
 */
export function OwnRow({ at, list }: { at: { grade: number; subject: string; chapter: string }; list: LpLesson[] }) {
  const C = useCopy(OWN);
  const on = useLpMakeOwn();
  const leader = useLessonsLeader();
  if (on !== true || leader || !list.some((l) => l.lane === 'g612' && l.kind === 'lesson')) return null;
  return (
    <section aria-label={C.forYourClass} className="flex flex-col gap-2" data-testid="own-entry">
      <h2 className="px-1 text-[13px] font-semibold text-[#4b5563]">{C.forYourClass}</h2>
      <div className={LIST_CARD}>
        <ListRow
          variant="row"
          first
          glyph={<PencilLine className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
          label={C.makeMyOwn}
          subtitle={C.fiveQuestions}
          to={ownUrl({ ...at, step: 'pages' })}
          testId="own-entry-row"
        />
      </div>
    </section>
  );
}
