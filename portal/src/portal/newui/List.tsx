import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS, PRESS } from './styles';

/**
 * bd-5rz1v.19 — lists of rows (deep-screens.html `.list`, `.row`).
 *
 * THE RULE THEY CARRY: information never looks tappable, and anything tappable does.
 *   - a row that goes somewhere (`to`) is a link with a chevron ›;
 *   - a row that does something (`onClick`) is a button with a chevron (or an `end` icon,
 *     e.g. a download);
 *   - a row with neither only informs: no chevron, no press colour, not focusable.
 *
 * Row: 60px minimum, 10px 12px padding, 12px gaps; a 42px icon tile (neutral grey; `done` is the
 * green check tile, `quiet` the muted one, `recording` the recording red); a 15.5px bold title; chips; an optional progress bar;
 * a value in dark 15px/800; the chevron in #a0a4b4, turned round in RTL.
 * States: `off` (dimmed to 55%, not tappable) and `selected` (indigo tint).
 */

export function List({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul
      aria-label={label}
      className={cn('overflow-hidden rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card', className)}
    >
      {children}
    </ul>
  );
}

export type RowTile = 'neutral' | 'quiet' | 'done' | 'recording';

const TILE: Record<RowTile, string> = {
  neutral: 'bg-nu-neutral-tile text-nu-neutral-icon',
  quiet: 'bg-nu-neutral-quiet text-nu-neutral-quiet-icon',
  done: 'bg-nu-done-bg text-nu-done',
  /** bd-5rz1v.26 — Record live lecture, and the lesson being recorded: the recording red. */
  recording: 'bg-nu-record-bg text-nu-record',
};

export interface RowProps {
  title: string;
  /** The icon in the 42px tile. */
  icon?: LucideIcon;
  /** Text in the tile instead of an icon: a day of the month, "D1", a lesson number. */
  lead?: string;
  /** The tile's look; `done` shows a green check unless an icon is given. */
  tile?: RowTile;
  chips?: ReactNode;
  /** A value at the end, dark text ("24%", "4", "Science"). */
  value?: ReactNode;
  /** Muted value — a count beside a choice. */
  valueMuted?: boolean;
  /** A green progress bar under the title, 0–100. */
  progress?: number;
  /** Goes somewhere: a link. */
  to?: string;
  /** Router state for `to`. */
  linkState?: unknown;
  /** Does something: a button. */
  onClick?: () => void;
  /** An icon in place of the chevron (a download, open elsewhere). */
  end?: LucideIcon;
  state?: 'off' | 'selected';
  /** The row's name for a screen reader when the title alone is not enough. */
  ariaLabel?: string;
  testId?: string;
}

export function Row({
  title, icon: Icon, lead, tile = 'neutral', chips, value, valueMuted, progress, to, linkState, onClick, end: End,
  state, ariaLabel, testId,
}: RowProps) {
  const tappable = Boolean(to || onClick);
  const off = state === 'off';
  const selected = state === 'selected';
  const TileIcon = Icon ?? (tile === 'done' && !lead ? Check : undefined);

  const body = (
    <>
      <span
        data-testid="newui-row-tile"
        aria-hidden="true"
        className={cn('flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[13px] font-extrabold', TILE[tile])}
      >
        {TileIcon ? <TileIcon className="h-[22px] w-[22px]" /> : lead}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15.5px] font-bold text-nu-surface-text rtl:text-[15px] rtl:font-semibold rtl:leading-[2]">
          {title}
        </span>
        {chips ? <span className="flex flex-wrap gap-[5px]">{chips}</span> : null}
        {progress != null ? <ProgressBar value={progress} label={title} /> : null}
      </span>
      {value != null && value !== '' ? (
        <span className={cn('whitespace-nowrap text-[15px] font-extrabold', valueMuted ? 'text-nu-surface-muted' : 'text-nu-surface-text')}>
          {value}
        </span>
      ) : null}
      {tappable ? (
        End ? (
          <End data-end className="h-[22px] w-[22px] shrink-0 text-nu-surface-chevron" aria-hidden="true" />
        ) : (
          <ChevronRight data-chevron className="h-[22px] w-[22px] shrink-0 text-nu-surface-chevron rtl:rotate-180" aria-hidden="true" />
        )
      ) : null}
    </>
  );

  // `group/row`: what a chip on the row keys on (bd-5rz1v.32 — an info chip is white on a selected
  // row, whose tint is the info chip's own fill). Chip.tsx holds the variant; no prop is threaded.
  const base = 'group/row flex min-h-[60px] w-full items-center gap-3 px-3 py-2.5 text-start';
  const look = cn(base, selected && 'bg-nu-select-tint', off && 'opacity-55');
  const li = 'border-b-[1.5px] border-nu-surface-line last:border-b-0';

  if (to && !off) {
    return (
      <li className={li}>
        <Link
          to={to}
          state={linkState}
          data-testid={testId}
          aria-label={ariaLabel}
          aria-current={selected ? 'true' : undefined}
          className={cn(look, FOCUS, !selected && PRESS)}
        >
          {body}
        </Link>
      </li>
    );
  }
  if (tappable) {
    return (
      <li className={li}>
        <button
          type="button"
          onClick={onClick}
          disabled={off}
          data-testid={testId}
          aria-label={ariaLabel}
          aria-current={selected ? 'true' : undefined}
          className={cn(look, FOCUS, !selected && !off && PRESS)}
        >
          {body}
        </button>
      </li>
    );
  }
  return (
    <li className={li}>
      <div data-testid={testId} className={look}>{body}</div>
    </li>
  );
}

/** A green bar on an indigo-light track, 6px (deep-screens.html `.prog`). */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className="block h-1.5 w-full overflow-hidden rounded-[6px] bg-nu-progress-track"
    >
      <span className="block h-full rounded-[6px] bg-nu-progress" style={{ width: `${v}%` }} />
    </span>
  );
}

/** A small heading over a list: 12px, uppercase, muted, with a count at the end (`.lbl`). */
export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h2 className="flex justify-between px-1 text-xs font-extrabold uppercase tracking-[0.06em] text-nu-surface-muted rtl:text-[13px] rtl:normal-case rtl:tracking-normal rtl:leading-[1.9]">
      <span>{children}</span>
      {aside != null ? <span>{aside}</span> : null}
    </h2>
  );
}
