import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { NotifyCopy } from './copy';
import { NoticeIcon } from './NoticeIcon';
import { Tray } from './Tray';
import { FOCUS, LIST_CARD, OUTLINE_WIDE, ROW_DIVIDER } from './styles';
import { useKitCopy } from './useKitCopy';

/**
 * bd-fmf24g.15 — ReadyCard (COMPONENTS.md §12): Home's "Ready for you", the finished things she has not opened yet.
 * A heading ("Ready for you", 20px/300) with a green count chip, then one white card with one 92px row per item:
 * the notice icon (feature glyph, green tick) → the title (16px/600) → "Lesson plan · Grade 7 Science" → a big indigo
 * "Open". The WHOLE row is the one button (a nested Open would be a second target in the same place). At most
 * `maxRows` (2), then "See all", which opens the full list in a bottom sheet.
 *
 * Which items, and for how long, is the server's (24 weekday hours, or until opened): this only draws them.
 */

export interface ReadyCardRow {
  id: string;
  feature: 'lessons' | 'assessment';
  /** "Lesson plan" / "Paper". */
  what: string;
  /** The title — data. */
  title: string;
  /** "Grade 7 · Science" — data. */
  line: string;
}

export interface ReadyCardProps {
  items: readonly ReadyCardRow[];
  maxRows?: number;
  onOpen: (id: string) => void;
  listOpen?: boolean;
  onOpenList?: () => void;
  onCloseList?: () => void;
  copy?: Partial<NotifyCopy>;
}

function Row({ row, first, words, onOpen }: { row: ReadyCardRow; first: boolean; words: NotifyCopy; onOpen: (id: string) => void }) {
  const bidi = useBidi();
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      aria-label={`${words.open} ${row.title}. ${row.what}, ${row.line}`}
      className={cn('flex min-h-[92px] w-full items-center gap-3 p-3 text-start', !first && ROW_DIVIDER, FOCUS)}
    >
      <NoticeIcon feature={row.feature} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir="auto" className="text-[16px] font-semibold leading-snug [overflow-wrap:anywhere]">{bidi(row.title)}</span>
        <span dir="auto" className="text-[13px] font-semibold text-[#374151]">{bidi(`${row.what} · ${row.line}`)}</span>
      </span>
      <span aria-hidden="true" className="flex h-14 shrink-0 items-center justify-center rounded-[14px] bg-[#33374a] px-4 text-[15px] font-semibold text-white">{words.open}</span>
    </button>
  );
}

export function ReadyCard({ items, maxRows = 2, onOpen, listOpen = false, onOpenList, onCloseList, copy }: ReadyCardProps) {
  const kit = useKitCopy();
  const words: NotifyCopy = { ...kit.notify, ...copy };
  if (items.length === 0) return null;
  return (
    <>
      <section aria-label={words.readyForYou} className="flex flex-col gap-2.5">
        <h2 className="mx-1 mb-0 mt-0.5 flex items-center gap-2 text-[20px] font-light">
          {words.readyForYou}
          <span className="inline-flex h-[26px] items-center rounded-full bg-[#eaf6ef] px-2.5 text-[12px] font-semibold text-[#2f7a52]">{items.length}</span>
        </h2>
        <div className={cn(LIST_CARD)}>
          {items.slice(0, maxRows).map((r, i) => <Row key={r.id} row={r} first={i === 0} words={words} onOpen={onOpen} />)}
        </div>
        {items.length > maxRows && onOpenList && (
          <button type="button" onClick={onOpenList} aria-haspopup="dialog" className={cn(OUTLINE_WIDE, FOCUS)}>{kit.seeAll}</button>
        )}
      </section>
      <Tray open={listOpen} title={words.readyForYou} onClose={onCloseList ?? (() => {})} testId="ready-list">
        <div className={cn(LIST_CARD)}>
          {items.map((r, i) => <Row key={r.id} row={r} first={i === 0} words={words} onOpen={onOpen} />)}
        </div>
      </Tray>
    </>
  );
}
