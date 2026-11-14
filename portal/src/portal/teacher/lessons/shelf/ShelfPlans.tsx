import { Users } from 'lucide-react';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { ListRow } from '../../ui';
import { useCopy } from '../../i18n';
import { lessonsUrl, type LessonsAt } from '../paths';
import { SHELF } from './copy';
import { fetchShelf } from './api';

type Lesson = { id: string; number?: number | null; title: string; lane?: string; kind?: string };

/**
 * bd-snkn32.42 — "Made by a teacher" on the chapter page: plans other teachers made for this chapter's lessons, each
 * passed by the AI reviewer AND approved by a person. A plan opens on the same Preparing page as any 6–12 plan, by its
 * own id (the bot answers that id for anyone once approved). Never who made it. None, or the read failed: nothing.
 */
export function ShelfPlans({ at, list }: { at: LessonsAt & { chapter: string }; list: Lesson[] }) {
  const C = useCopy(SHELF);
  const lessons = list.filter((l) => l.kind !== 'worksheet' && l.kind !== 'revision');
  const keys = lessons.map((l) => l.id);
  const [shelf] = useLoad(keys.length ? () => fetchShelf(keys) : null, `shelf:${keys.join(',')}`);
  const plans = dataOf(shelf) ?? [];
  if (!plans.length) return null;
  const name = (lesson: string, band: string) => {
    const l = lessons.find((x) => x.id === lesson);
    if (!l) return C.shelfTitle;
    return l.number != null ? `${band === 'k5' ? C.dayN(l.number) : C.lessonN(l.number)} · ${l.title}` : l.title;
  };
  return (
    <section className="mt-6 flex flex-col gap-2" data-testid="own-shelf">
      <h2 className="text-[15px] font-semibold text-[#33374a]">{C.shelfTitle}</h2>
      <p className="text-[13px] text-[#6b7280]">{C.shelfHint}</p>
      {plans.map((p) => (
        <ListRow
          key={p.ownId}
          variant="card"
          glyph={<Users className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
          label={name(p.lesson, p.band)}
          subtitle={C.langs[p.lang === 'ur' ? 'ur' : 'en']}
          to={lessonsUrl('preparing', {
            ...at, lesson: p.lesson, render: p.ownId, title: lessons.find((x) => x.id === p.lesson)?.title ?? C.shelfTitle,
          })}
        />
      ))}
    </section>
  );
}
