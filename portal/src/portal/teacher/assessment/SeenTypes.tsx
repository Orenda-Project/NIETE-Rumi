import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssessmentQuestionType } from '../../services/api';
import { Tray } from '../ui/Tray';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { livePicks, seenByType, type Picks } from './model';
import { BookPicker } from './BookPicker';
import { CheckRow, CountRow, ListCard, LoadState, PRIMARY } from './ui';
import type { setPicks } from './store';

const GROUP_STICKY = 'sticky top-0 z-[1] -mx-3.5 bg-[#f3f4f6] px-5 py-2 text-[13px] font-bold uppercase tracking-[.04em] text-[#6b7280]';

/**
 * bd-e5n2jf — Seen (book) questions by type, like Unseen (Mubashar Zia, 20 Nov). With no Seen type
 * she keeps the single "as in the book" box; the first type she ticks takes that count, and removing
 * the last type brings the single box back.
 */
export function SeenTypes({ p, set, offered, status, retry, full, over }: {
  p: Picks;
  set: typeof setPicks;
  offered: AssessmentQuestionType[];
  status: 'idle' | 'loading' | 'error' | 'ok';
  retry: () => void;
  full: boolean;
  over: boolean;
}) {
  const C = useCopy(ASSESSMENT);
  const [tray, setTray] = useState(false);
  const byType = seenByType(p);
  // AG row 21: ticked book questions ARE the seen part; the count rows step aside while she has any.
  const ticked = livePicks(p).length > 0;
  const rows = Object.entries(p.seenTypeCounts ?? {});
  const num = (d: string) => Number(d || '0');

  const setCount = (id: string, n: number) =>
    set((cur) => ({ seenTypeCounts: { ...cur.seenTypeCounts, [id]: Math.max(0, n) } }));
  const remove = (id: string) => set((cur) => {
    const next = { ...cur.seenTypeCounts };
    delete next[id];
    return { seenTypeCounts: Object.keys(next).length > 0 ? next : undefined };
  });
  const add = (id: string) => set((cur) => {
    const first = !seenByType(cur);
    return { seenTypeCounts: { ...cur.seenTypeCounts, [id]: first ? Math.max(1, cur.seen) : 1 } };
  });

  const group = (category: 'objective' | 'subjective', name: string) => {
    const list = offered.filter((t) => t.category === category);
    if (list.length === 0) return null;
    return (
      <>
        <p className={GROUP_STICKY}>{name}</p>
        <ListCard label={name}>
          {list.map((t, i) => {
            const on = t.id in (p.seenTypeCounts ?? {});
            return (
              <CheckRow
                key={t.id}
                first={i === 0}
                checked={on}
                onToggle={() => (on ? remove(t.id) : add(t.id))}
                label={<span className="min-w-0 flex-1 text-[16px] font-semibold">{t.id}</span>}
              />
            );
          })}
        </ListCard>
      </>
    );
  };

  return (
    <>
      <ListCard label={C.seenQuestions}>
        <BookPicker p={p} set={set} first />
        {!ticked && !byType && (
          <CountRow
            first
            name={C.asInBook}
            ariaName={C.typeCount(C.seenQuestions)}
            value={String(p.seen)}
            dim={p.seen === 0}
            error={over && p.seen > 0}
            onType={(d) => set({ seen: num(d) })}
            onLess={() => set({ seen: Math.max(0, p.seen - 1) })}
            onMore={() => set({ seen: p.seen + 1 })}
            canLess={p.seen > 0}
            canMore={!full}
            lessLabel={C.fewerOf(C.seenQuestions)}
            moreLabel={C.moreOf(C.seenQuestions)}
            testId="count-seen"
          />
        )}
        {!ticked && byType && rows.map(([id, n], i) => (
          <div key={id} data-testid={`seen-type-count-${id}`}>
          <CountRow
            first={i === 0}
            name={id}
            ariaName={C.seenTypeCount(id)}
            value={String(n)}
            dim={n === 0}
            error={over && n > 0}
            bin={n <= 1}
            onType={(d) => setCount(id, num(d))}
            onLess={() => (n <= 1 ? remove(id) : setCount(id, n - 1))}
            onMore={() => setCount(id, n + 1)}
            canLess
            canMore={!full}
            lessLabel={n <= 1 ? C.removeType(id) : C.fewerOf(id)}
            moreLabel={C.moreOf(id)}
            testId={`seen-type-input-${id}`}
          />
          </div>
        ))}
        {!ticked && <button
          type="button"
          data-testid="add-seen-type"
          onClick={() => setTray(true)}
          className={cn('flex min-h-[60px] w-full items-center justify-center gap-2 border-t border-dashed border-[#c7cad6] text-[16px] font-semibold text-[#33374a]', FOCUS)}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {C.addSeenType}
        </button>}
      </ListCard>

      <Tray open={tray} tall title={C.seenTypesTitle} onClose={() => setTray(false)} closeLabel={C.close} testId="seen-types-tray">
        <div className="-mx-3.5 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3.5 pb-1 [&>*]:shrink-0">
          {status !== 'ok' ? <LoadState status={status} onRetry={retry} /> : <>{group('objective', C.objective)}{group('subjective', C.written)}</>}
        </div>
        <div className="-mx-3.5 flex shrink-0 items-center gap-3 border-t border-[#e5e7eb] px-3.5 pt-2.5">
          <p className="whitespace-nowrap px-1.5 text-[15px] font-semibold text-[#6b7280]">{C.typesCap(rows.length, offered.length)}</p>
          <button type="button" onClick={() => setTray(false)} className={cn(PRIMARY, FOCUS)}>{C.done}</button>
        </div>
      </Tray>
    </>
  );
}
