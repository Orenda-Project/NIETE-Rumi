import type { ReactElement } from 'react';
import { Check, ChevronRight, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { StatusChip } from './StatusChip';
import { CARD, CARD_SELECTED, CHEVRON, FOCUS, ROW_DIVIDER, ROW_SELECTED, ROW_SUB, ROW_TITLE, type ChipData } from './styles';

/**
 * bd-fmf24g.2.1 — ListRow (COMPONENTS.md §3): a numbered thing — a chapter, a lesson, a part. A 52px rounded-12
 * lead with the PREFIX stacked over the NUMBER (operator's choice, 8 Oct): the prefix 10px/800 caps over the
 * number 20px/800. The "#" belongs to the prefix ("LP #" over 4), so a leading "#" on the number is dropped.
 * An `icon` (worksheet, revision, file) replaces the number. Title 16px/600 (2 lines) + subtitle, chip, chevron.
 *
 *   used     the green "✓ Used" chip;
 *   locked   55%, a lock instead of the chevron, not tappable;
 *   selected like GradeSubjectButton's: indigo edge + tint (card) or tint + start bar (row), a tinted tile, an
 *            indigo check instead of the chevron (aria-current on a link, aria-pressed on a button).
 *
 * `to` makes it a link; otherwise a button that calls `onPress` (a picker selects the row in place).
 * (The canvas's deprecated `prefixStyle="inline"` is not ported.)
 */

export type ListRowIcon = 'worksheet' | 'revision' | 'file';
export type ListRowState = 'default' | 'used' | 'locked' | 'selected';

export interface ListRowProps {
  /** Above the number, carrying any "#": "Chap", "LP #", "Part". Left out: the number alone. */
  prefix?: string;
  number?: string | number;
  icon?: ListRowIcon;
  label: string;
  subtitle?: string;
  chip?: ChipData | null;
  state?: ListRowState;
  variant?: 'card' | 'row';
  /** Row variant: the first row has no divider above it. */
  first?: boolean;
  to?: string;
  onPress?: () => void;
  copy?: Partial<Pick<TeacherUiCopy, 'used' | 'selected' | 'locked'>>;
  className?: string;
}

const ICON: Record<ListRowIcon, ReactElement> = {
  worksheet: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  revision: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </>
  ),
};

export function ListRow({
  prefix = '', number = '', icon, label, subtitle, chip, state = 'default', variant = 'card', first = true, to, onPress,
  copy, className,
}: ListRowProps) {
  const words = { ...useKitCopy(), ...copy };
  const locked = state === 'locked';
  const selected = state === 'selected';
  const used = state === 'used';
  const shownChip: ChipData | null = chip?.text ? chip : used ? { text: words.used, tone: 'done' } : null;
  const num = String(number).replace(/^#\s*/, '');

  const box = cn(
    'flex w-full min-h-[76px] items-center gap-3.5 text-start text-[#1d2025]',
    variant === 'row'
      ? cn('py-2.5 pe-3.5 ps-3', !first && ROW_DIVIDER, selected ? ROW_SELECTED : 'bg-white')
      : selected ? cn(CARD_SELECTED, 'py-[9px] pe-[13px] ps-[11px]') : cn(CARD, 'py-2.5 pe-3.5 ps-3'),
    locked && 'opacity-[.55]',
    className,
  );

  const lead = (
    <span
      data-testid="listrow-lead"
      className={cn(
        'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl leading-none text-[#33374a]',
        selected ? 'bg-[#e8e9f0]' : 'bg-[#f3f4f6]',
        icon ? 'flex-row' : 'flex-col',
      )}
    >
      {icon ? (
        <svg data-icon={icon} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {ICON[icon]}
        </svg>
      ) : prefix ? (
        <>
          <span className="whitespace-nowrap text-[10px] font-extrabold uppercase tracking-[.04em] text-[#6b7280]">{prefix}</span>
          <span className="mt-[3px] whitespace-nowrap text-[20px] font-extrabold tabular-nums">{num}</span>
        </>
      ) : (
        <span className="text-[20px] font-extrabold tabular-nums">{num}</span>
      )}
    </span>
  );
  const middle = (
    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className={cn(ROW_TITLE, 'line-clamp-2')}>{label}</span>
      {subtitle ? <span className={ROW_SUB}>{subtitle}</span> : null}
    </span>
  );
  const chipEl = shownChip ? <StatusChip text={shownChip.text} tone={shownChip.tone} tick={used && !chip?.text} /> : null;

  if (locked) {
    return (
      <div aria-disabled="true" className={box}>
        {lead}
        {middle}
        {chip?.text ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
        <span role="img" aria-label={words.locked} className="flex shrink-0 text-[#6b7280]">
          <Lock className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>
    );
  }

  const end = (
    <>
      {chipEl}
      {selected ? (
        <span role="img" aria-label={words.selected} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-white">
          <Check className="h-4 w-4" strokeWidth={3.2} aria-hidden="true" />
        </span>
      ) : (
        <ChevronRight data-chevron className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} aria-current={selected ? 'true' : undefined} className={cn(box, FOCUS)}>
        {lead}
        {middle}
        {end}
      </Link>
    );
  }
  return (
    <button type="button" aria-pressed={selected} onClick={() => onPress?.()} className={cn(box, 'cursor-pointer', FOCUS)}>
      {lead}
      {middle}
      {end}
    </button>
  );
}
