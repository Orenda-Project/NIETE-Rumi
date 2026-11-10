import { useEffect, useRef, useState } from 'react';
import { ChoiceChips } from '../../ui';
import { FOCUS, LIST_CARD } from '../../ui/styles';
import type { OwnCopy } from './copy';
import { EXTENDS, type Extend } from './extend';
import { RadioList } from './Options';
import { PagesBox } from './PagesBox';
import { BookPages } from './BookPages';
import { checkBand, fmtPg, parseLabel, type PageRange, type PagesPick } from './pages';

/**
 * step 1, the same for every band (the unified spec's screen 1): "Which day?" / "Which lesson?" as a
 * radio list; once picked, one card with Change, the book pages right under it, the book's own text, and (6–12, when
 * the range runs to the next lesson's end) "How will you teach both?", none pre-picked. Replaces AddNext.
 */
export type PlanRow = { id: string; number: number | null; title: string; pages: string | null; lane: 'k5' | 'g612' };

export function PagesStep({ C, plans, seg, next, start, ext, onPick, onClear, onPages, onExt }: {
  C: OwnCopy; plans: readonly PlanRow[]; seg: PlanRow | null; next: PlanRow | null;
  /** Her pages from the address, if any. */
  start: PageRange | null; ext: Extend | null;
  onPick: (id: string) => void; onClear: () => void; onPages: (p: PagesPick | null) => void; onExt: (e: Extend) => void;
}) {
  const top = useRef<HTMLDivElement>(null);
  const k5 = (seg ?? plans[0])?.lane === 'k5';
  const name = (l: PlanRow) => (l.number != null ? `${k5 ? C.dayN(l.number) : C.lessonN(l.number)} · ${l.title}` : l.title);
  const lesson = seg ? parseLabel(seg.pages) : null;
  const nextPages = next ? parseLabel(next.pages) : null;
  const [range, setRange] = useState<PagesPick | null>(() => checkBand(k5, String((start ?? lesson)?.start ?? ''), String((start ?? lesson)?.end ?? ''), lesson, nextPages));
  useEffect(() => { if (seg) top.current?.scrollIntoView?.({ block: 'start' }); }, [seg]);

  if (!seg) {
    return <RadioList label={k5 ? C.day : C.whichLesson} items={plans.map((l) => ({ key: l.id, label: name(l), subtitle: l.pages ?? undefined }))} value={null} onPick={onPick} />;
  }
  const valid = (f: string, t: string) => !!checkBand(k5, f, t, lesson, nextPages);
  const typed = (f: string, t: string) => { const p = checkBand(k5, f, t, lesson, nextPages); setRange(p); onPages(p); };
  return (
    <div ref={top} className="flex flex-col gap-3">
      <div className={`${LIST_CARD} flex min-h-[56px] items-center gap-3 px-4 py-2`} data-testid="own-pg-card">
        <span className="flex-1 text-[16px] font-semibold">{[name(seg), seg.pages].filter(Boolean).join(' · ')}</span>
        <button type="button" onClick={onClear} data-testid="own-pg-change" className={`min-h-[48px] text-[15px] font-semibold text-[#4f46e5] ${FOCUS}`}>{C.change}</button>
      </div>
      {lesson ? (
        <PagesBox key={seg.id} C={C} start={start ?? lesson} next={nextPages} valid={valid} onChange={typed}
          addLabel={nextPages ? (k5 ? C.addNextDay(fmtPg(nextPages)) : C.addNextLesson(fmtPg(nextPages))) : ''}
          badText={k5 ? C.badPages : C.badPages612} />
      ) : null}
      {!k5 && range?.both ? (
        <div data-testid="own-ext">
          <ChoiceChips label={C.bothHow} options={EXTENDS.map((k) => ({ key: k, label: C.extends[k] }))} value={ext} onChange={(k) => onExt(k as Extend)} />
        </div>
      ) : null}
      {lesson ? <BookPages C={C} lesson={seg.id} lane={seg.lane} range={range?.range ?? null} /> : null}
    </div>
  );
}
