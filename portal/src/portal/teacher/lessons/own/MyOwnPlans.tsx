import { FileText } from 'lucide-react';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { ListRow } from '../../ui';
import { useCopy } from '../../i18n';
import { lessonsUrl } from '../paths';
import { OWN } from './copy';
import { fetchMyOwnPlans } from './api';
import type { PlanRow } from './PagesStep';

/**
 * bd-snkn32.20 — "Your plans for this chapter" (operator, 10 Nov: "can we make sure it can be edited too?"): her own
 * Make my own plans on this chapter's lessons, newest first, under step 1. Each opens on the 6–12 Preparing page with
 * its own id, whose viewer already draws the section cards and "Change this plan" with the changes she has left.
 * None, or the read failed: nothing, so the step is exactly as before.
 */
export function MyOwnPlans({ at, plans }: { at: { grade: number; subject: string; chapter: string }; plans: PlanRow[] }) {
  const C = useCopy(OWN);
  const keys = plans.map((p) => p.id);
  const [mine] = useLoad(keys.length ? () => fetchMyOwnPlans(keys) : null, `mine:${keys.join(',')}`);
  const list = dataOf(mine) ?? [];
  if (!list.length) return null;
  const name = (lesson: string) => {
    const p = plans.find((x) => x.id === lesson);
    if (!p) return C.makeMyOwn;
    return p.number != null ? `${p.lane === 'k5' ? C.dayN(p.number) : C.lessonN(p.number)} · ${p.title}` : p.title;
  };
  return (
    <section className="mt-6 flex flex-col gap-2" data-testid="own-mine">
      <h2 className="text-[15px] font-semibold text-[#33374a]">{C.myPlans}</h2>
      {list.map((m) => {
        const p = plans.find((x) => x.id === m.lesson);
        return (
          <ListRow
            key={m.ownId}
            variant="card"
            glyph={<FileText className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
            label={name(m.lesson)}
            subtitle={m.status === 'ready' ? C.changesLeft(m.changesLeft) : C.beingMade}
            to={lessonsUrl('preparing', { ...at, lesson: m.lesson, render: m.ownId, title: p?.title ?? C.makeMyOwn })}
          />
        );
      })}
    </section>
  );
}
