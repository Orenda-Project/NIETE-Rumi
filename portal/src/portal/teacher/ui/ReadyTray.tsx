import { ChevronRight, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FeatureGlyph, FEATURE_HUE } from '../icons';
import { useBidi } from './bidi';
import type { NotifyCopy } from './copy';
import { Tray } from './Tray';
import { CHEVRON, FOCUS, LIST_CARD, ROW_DIVIDER } from './styles';
import { useKitCopy } from './useKitCopy';

/**
 * bd-fmf24g.15 — ReadyTray (COMPONENTS.md §12): "it is being made", on every screen. A grey strip docked directly
 * above the bottom menu holding one white card (16px corners) with one 64px row per item: a 48px progress ring in
 * the feature's colour around the feature's glyph → "Lesson plan · Grade 7 Science" → "Being made · ~1 min left"
 * (a pulsing amber dot, only when motion is allowed) → a chevron. A tap goes to that item's waiting page.
 *
 *   at most `maxRows` (2) rows; a 3rd or more adds ONE 56px row, "+N more · See all", which opens the list (a
 *   bottom sheet: every item with its title on a line of its own);
 *   past its time a row says "Almost done" (never a countdown below zero);
 *   FAILED: the ring and the line turn red ("Couldn't make it · Try again") and the row stays until she taps it —
 *   `onFollow(id)` tells the host, which lets the item go;
 *   `hideId`: the item the page already shows is not repeated.
 *
 * The strip knows nothing of jobs: the host (teacher/notices) gives it plain rows and the words that are data.
 * Its height is `trayHeight()`, which the host passes to the page so the page's last row stays above it.
 */

export interface TrayRow {
  id: string;
  /** Whose colour the ring takes. */
  feature: 'lessons' | 'assessment';
  /** "Lesson plan" / "Paper". */
  what: string;
  /** "Grade 7 · Science" — data. */
  gradeSubject: string;
  /** The plan's or chapter's title — data. */
  title: string;
  state: 'making' | 'failed';
  /** 0..1 */
  progress: number;
  /** "~1 min left"; empty once it is past its time ("Almost done"). */
  left: string;
  /** Its waiting page. */
  to: string;
}

export interface ReadyTrayProps {
  items: readonly TrayRow[];
  maxRows?: number;
  hideId?: string;
  /** A row was followed (a failed one lets the host forget it). */
  onFollow?: (id: string) => void;
  onOpenList: () => void;
  listOpen?: boolean;
  onCloseList?: () => void;
  /** The sentence under the list's title. */
  note?: string;
  copy?: Partial<NotifyCopy>;
}

/** The strip's own height: 1px edge + 8px padding each side + the card's 2px edge + 64px a row + 56px for the "more" row. */
export const trayHeight = (rows: number, hasMore: boolean): number => (rows > 0 ? 19 + 64 * rows + (hasMore ? 56 : 0) : 0);

const RING = 48;
const R = 21;
const LEN = 2 * Math.PI * R;
const FAILED = { fg: '#c8331f', bg: '#fee4e2' };

function Ring({ row }: { row: TrayRow }) {
  const hue = row.state === 'failed' ? FAILED : FEATURE_HUE[row.feature];
  const p = row.state === 'failed' ? 0 : Math.max(0, Math.min(1, row.progress));
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden="true">
      <svg data-testid="notice-ring" data-progress={Math.round(p * 100)} width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="absolute inset-0 -rotate-90">
        <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke={row.state === 'failed' ? hue.bg : '#e5e7eb'} strokeWidth="5" />
        {p > 0 && (
          <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke={hue.fg} strokeWidth="5" strokeLinecap="round" strokeDasharray={LEN} strokeDashoffset={LEN * (1 - p)} />
        )}
      </svg>
      <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: row.state === 'failed' ? '#fff' : hue.bg, color: hue.fg }}>
        <FeatureGlyph name={row.feature} size={22} />
      </span>
    </span>
  );
}

function Row({ row, first, withTitle, words, onFollow }: { row: TrayRow; first: boolean; withTitle: boolean; words: NotifyCopy; onFollow?: (id: string) => void }) {
  const bidi = useBidi();
  const failed = row.state === 'failed';
  const status = failed ? `${words.couldntMake} · ${words.tryAgain}` : `${words.beingMade} · ${row.left || words.almostDone}`;
  const name = `${row.what}, ${row.gradeSubject}, ${row.title}. ${failed ? `${words.couldntMake}. ${words.tryAgain}.` : `${words.beingMade}, ${row.left || words.almostDone}.`}`;
  return (
    <Link
      to={row.to}
      onClick={() => onFollow?.(row.id)}
      aria-label={name}
      className={cn('flex min-h-[64px] w-full items-center gap-3 px-2.5 py-2', !first && ROW_DIVIDER, withTitle && 'min-h-[76px]', FOCUS)}
    >
      <Ring row={row} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir="auto" className="truncate text-[15px] font-semibold leading-snug">{bidi(`${row.what} · ${row.gradeSubject}`)}</span>
        {withTitle && <span dir="auto" className="truncate text-[13px] font-medium leading-snug text-[#374151]">{bidi(row.title)}</span>}
        <span className={cn('flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-snug', failed ? 'font-semibold text-[#c8331f]' : 'text-[#6b7280]')}>
          {!failed && <i aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#b45309] motion-safe:animate-pulse" />}
          <span className={cn('truncate', failed && 'text-[#c8331f]')}>{bidi(status)}</span>
        </span>
      </span>
      <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} aria-hidden="true" />
    </Link>
  );
}

export function ReadyTray({
  items, maxRows = 2, hideId, onFollow, onOpenList, listOpen = false, onCloseList, note, copy,
}: ReadyTrayProps) {
  const kit = useKitCopy();
  const words: NotifyCopy = { ...kit.notify, ...copy };
  const bidi = useBidi();
  const shown = items.filter((i) => i.id !== hideId);
  if (shown.length === 0) return null;
  const rows = shown.slice(0, maxRows);
  const hidden = shown.slice(maxRows);
  return (
    <>
      <div role="region" aria-label={words.beingMade} data-testid="notice-tray" className="border-t border-[#e5e7eb] bg-[#f3f4f6] p-2">
        <div className={cn(LIST_CARD)}>
          {rows.map((r, i) => <Row key={r.id} row={r} first={i === 0} withTitle={false} words={words} onFollow={onFollow} />)}
          {hidden.length > 0 && (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`${words.more(hidden.length)}. ${kit.seeAll}`}
              onClick={onOpenList}
              className={cn('flex min-h-[56px] w-full items-center gap-3 py-1.5 ps-3.5 pe-2.5 text-[15px] font-semibold text-[#33374a]', ROW_DIVIDER, FOCUS)}
            >
              <span aria-hidden="true" className="flex w-10 shrink-0 items-center justify-center">
                {hidden.slice(0, 2).map((h, i) => (
                  <i key={h.id} className={cn('block h-[18px] w-[18px] rounded-full border-2 border-white', i > 0 && '-ms-1.5')} style={{ background: FEATURE_HUE[h.feature].fg }} />
                ))}
              </span>
              <span className="min-w-0 flex-1 text-start">{bidi(words.more(hidden.length))}</span>
              <span className="inline-flex items-center gap-0.5 text-[14px] font-bold">{kit.seeAll}<ChevronUp className="h-5 w-5" aria-hidden="true" /></span>
            </button>
          )}
        </div>
      </div>
      <Tray open={listOpen} title={`${words.beingMade} (${shown.length})`} onClose={onCloseList ?? (() => {})} testId="notice-list">
        {note && <p className="mx-1 text-[14px] text-[#6b7280]">{note}</p>}
        <div className={cn(LIST_CARD)}>
          {shown.map((r, i) => <Row key={r.id} row={r} first={i === 0} withTitle words={words} onFollow={onFollow} />)}
        </div>
      </Tray>
    </>
  );
}
