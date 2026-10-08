import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { HistoryRow, type HistoryRowProps } from './HistoryRow';
import { FOCUS, LIST_CARD, OUTLINE_WIDE } from './styles';

/**
 * bd-fmf24g.2.1 — HistoryList (COMPONENTS.md §2): a history grouped by day — lesson plans opened, observations,
 * papers. An optional heading (22px/600) with the total; per day a light 20px/300 heading ("Today", "Mon 5 Oct",
 * the screen's words) with its count, then ONE white card with the rows; a full-width Show more at the end; with
 * no rows, the dashed empty card.
 *
 * collapsible (operator: "The Recent Lesson Plans can be toggleable"): the heading row becomes a ≥56px toggle
 *   (aria-expanded) with a 40px round chevron; collapsed = only the heading. `open`, when given, sets it from
 *   outside; a tap still toggles until `open` changes. `defaultOpen` (true) when nothing says.
 * seeAllTo (operator: "the 'Recent DC/LP' list has a gap… a link to 'All'"): "See all ›" ends the heading row,
 *   collapsed and open, and a full-width See all REPLACES Show more — one pattern, one destination (the All page).
 *   With a collapsible heading the chevron becomes a 22px one after the count, so heading + count + chevron +
 *   link fit 358px; a long heading wraps rather than push the link off.
 */

export type HistoryItem = Omit<HistoryRowProps, 'first' | 'copy'> & { id?: string | number };
export interface HistoryGroup {
  /** The day's heading — the screen's words ("Today", "Yesterday", "Mon 5 Oct"). */
  day: string;
  items: HistoryItem[];
}

export interface HistoryListProps {
  /** "" or left out: no heading row (and no See all at the top). */
  heading?: string;
  groups: HistoryGroup[];
  /** Show more at the end (when there are rows); not shown with seeAllTo. */
  showMore?: boolean;
  onShowMore?: () => void;
  emptyLabel?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The All page. */
  seeAllTo?: string;
  onSeeAll?: () => void;
  copy?: Partial<Pick<TeacherUiCopy, 'grade' | 'download' | 'newItem' | 'showMore' | 'seeAll' | 'seeAllNamed' | 'nothingYet'>>;
  className?: string;
}

const COUNT = 'inline-flex shrink-0 items-center rounded-full bg-[#e5e7eb] text-[12px] font-semibold text-[#374151]';

export function HistoryList({
  heading = '', groups, showMore = true, onShowMore, emptyLabel, collapsible = false, defaultOpen = true, open,
  onOpenChange, seeAllTo, onSeeAll, copy, className,
}: HistoryListProps) {
  const words = { ...useKitCopy(), ...copy };
  const rowCopy = { grade: words.grade, download: words.download, newItem: words.newItem };
  const days = groups.filter((g) => g.items.length > 0);
  const total = days.reduce((n, g) => n + g.items.length, 0);

  // A tap overrides `open` only until `open` itself changes.
  const [toggled, setToggled] = useState<{ value: boolean; forProp: boolean | undefined } | null>(null);
  useEffect(() => { setToggled(null); }, [open]);
  const canToggle = collapsible && !!heading;
  const fromProp = open ?? defaultOpen;
  const isOpen = !canToggle || (toggled && toggled.forProp === open ? toggled.value : fromProp);
  const toggle = () => {
    setToggled({ value: !isOpen, forProp: open });
    onOpenChange?.(!isOpen);
  };

  const seeAll = !!seeAllTo;
  const seeAllName = words.seeAllNamed(heading);
  const countChip = total > 0 ? <span className={cn(COUNT, 'h-[26px] px-2.5')}>{total}</span> : null;
  const topLink = seeAll ? (
    <Link
      to={seeAllTo as string}
      onClick={() => onSeeAll?.()}
      aria-label={seeAllName}
      className={cn('flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-end gap-0.5 whitespace-nowrap pe-0.5 ps-2.5 text-[16px] font-bold text-[#33374a]', FOCUS)}
    >
      {words.seeAll}
      <ChevronRight className="h-[18px] w-[18px] rtl:rotate-180" strokeWidth={2.6} aria-hidden="true" />
    </Link>
  ) : null;

  let head = null;
  if (heading && canToggle) {
    const button = (
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={cn('flex min-h-[56px] w-full min-w-0 items-center gap-2 px-1 text-start', FOCUS)}
      >
        <span className="min-w-0 text-[22px] font-semibold leading-[1.2]">{heading}</span>
        {countChip}
        {seeAll ? (
          <ChevronDown data-toggle-chevron="inline" className={cn('h-[22px] w-[22px] shrink-0 text-[#33374a]', isOpen && 'rotate-180')} strokeWidth={2.6} aria-hidden="true" />
        ) : (
          <span data-toggle-chevron="circle" className="ms-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]">
            <ChevronDown className={cn('h-5 w-5', isOpen && 'rotate-180')} strokeWidth={2.4} aria-hidden="true" />
          </span>
        )}
      </button>
    );
    head = (
      <div className="mt-1.5 flex items-center gap-1">
        <h2 className="m-0 min-w-0 flex-1">{button}</h2>
        {topLink}
      </div>
    );
  } else if (heading) {
    head = (
      <div className={cn('flex items-center gap-1', seeAll ? 'mt-1.5 min-h-[56px]' : 'mt-3')}>
        <h2 className="m-0 ms-1 flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[22px] font-semibold leading-[1.2]">
          {heading}
          {countChip}
        </h2>
        {topLink}
      </div>
    );
  }

  return (
    <div className={cn('flex w-full flex-col gap-2.5 text-[#1d2025]', className)}>
      {head}
      {isOpen ? (
        <>
          {days.length === 0 ? (
            <div data-empty className="flex min-h-[160px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-[#d1d5db] bg-white px-4 py-6 text-[#6b7280]">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f3f4f6] text-[#9ca3af]">
                <Clock className="h-[26px] w-[26px]" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="text-[16px] font-semibold">{emptyLabel ?? words.nothingYet}</span>
            </div>
          ) : null}
          {days.map((g) => (
            <section key={g.day} aria-label={g.day} className="flex flex-col gap-2">
              <h3 className="mx-1 mb-0 mt-2 flex items-center gap-2 text-[20px] font-light leading-[1.2]">
                {g.day}
                <span className={cn(COUNT, 'h-6 px-[9px]')}>{g.items.length}</span>
              </h3>
              <div className={LIST_CARD}>
                {g.items.map(({ id, ...item }, i) => (
                  <HistoryRow key={id ?? i} {...item} first={i === 0} copy={rowCopy} />
                ))}
              </div>
            </section>
          ))}
          {days.length > 0 && seeAll ? (
            <Link to={seeAllTo as string} onClick={() => onSeeAll?.()} aria-label={seeAllName} className={cn(OUTLINE_WIDE, 'mt-1', FOCUS)}>
              {words.seeAll}
              <ChevronRight className="h-[18px] w-[18px] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
            </Link>
          ) : null}
          {days.length > 0 && !seeAll && showMore ? (
            <button type="button" onClick={() => onShowMore?.()} className={cn(OUTLINE_WIDE, 'mt-1', FOCUS)}>
              {words.showMore}
              <ChevronDown className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
