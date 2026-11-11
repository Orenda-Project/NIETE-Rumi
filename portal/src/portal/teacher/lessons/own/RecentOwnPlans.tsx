import { FileText } from 'lucide-react';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { ListRow } from '../../ui';
import { useCopy } from '../../i18n';
import { lessonsUrl } from '../paths';
import { OWN } from './copy';
import { fetchRecentOwnPlans } from './api';
import { useLpMakeOwn } from './flag';

/**
 * bd-snkn32.5 — "My own plans" on Lesson Plans home (operator, 10 Nov: "it should be able to open either through
 * whatsapp iab or the portal directly"): her own Make my own plans, newest first, every grade. Each opens on the
 * Preparing page in its own grade, subject and chapter with its own id, whose viewer draws the section cards and
 * "Change this plan". Make my own off, none, or the read failed: nothing, so the page is exactly as before.
 */
export function RecentOwnPlans() {
  const C = useCopy(OWN);
  const on = useLpMakeOwn();
  const [recent] = useLoad(on ? () => fetchRecentOwnPlans() : null, on ? 'own:recent' : 'own:recent:off');
  const list = dataOf(recent) ?? [];
  if (!on || !list.length) return null;
  return (
    <section className="mt-3.5 flex flex-col gap-2" data-testid="own-recent">
      <h2 className="mx-1 text-[20px] font-light">{C.myOwnPlans}</h2>
      {list.map((m) => (
        <ListRow
          key={m.ownId}
          variant="card"
          glyph={<FileText className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
          label={m.title || C.makeMyOwn}
          subtitle={m.status === 'ready' ? C.changesLeft(m.changesLeft) : C.beingMade}
          to={lessonsUrl('preparing', {
            grade: m.grade, subject: m.subject, chapter: m.chapter, lesson: m.lesson, render: m.ownId, title: m.title || C.makeMyOwn,
          })}
        />
      ))}
    </section>
  );
}
