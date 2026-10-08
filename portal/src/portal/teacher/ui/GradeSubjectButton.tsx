import { Check, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TEACHER_UI_COPY, type TeacherUiCopy } from './copy';
import { StatusChip } from './StatusChip';
import { gradeSubjectLabel } from './subjects';
import { SubjectTile } from './SubjectTile';
import { CARD, CARD_SELECTED, CHEVRON, FOCUS, ROW_DIVIDER, ROW_SELECTED, ROW_SUB, ROW_TITLE, type ChipData } from './styles';

/**
 * bd-fmf24g.2.1 — GradeSubjectButton (COMPONENTS.md §1): a tappable grade + subject, or a class — My classes, a
 * picker's rows. SubjectTile + "Grade 4 · General Science" (16px/600) + an optional second line (13px muted) +
 * an optional chip + the chevron. A class reads "Grade 4-A · General Science"; no grade shows the subject alone.
 *
 *   card (own white card) or row (flat, inside one list card; a 1px divider after the first);
 *   default · selected (2px indigo edge on the tint, tinted tile, an indigo check instead of the chevron; a row
 *   gets the tint and a 3px indigo bar on its start edge) · disabled (45%, no chevron, not tappable).
 *
 * `to` makes it a link; otherwise it is a button (aria-pressed = selected) that calls `onPress`. 76px tall.
 */

export type GradeSubjectState = 'default' | 'selected' | 'disabled';

export interface GradeSubjectButtonProps {
  /** "" or null: no grade — the subject alone (a subject picker's rows). */
  grade?: string | number | null;
  /** A class's section: "A" → "Grade 4-A". */
  section?: string;
  subject: string;
  /** The second line ("32 students"). */
  sub?: string;
  chip?: ChipData | null;
  state?: GradeSubjectState;
  variant?: 'card' | 'row';
  /** Row variant: the first row has no divider above it. */
  first?: boolean;
  /** Where it goes (a link). Leave out for a button. */
  to?: string;
  onPress?: () => void;
  copy?: Partial<Pick<TeacherUiCopy, 'grade' | 'selected'>>;
  className?: string;
}

export function GradeSubjectButton({
  grade = '', section = '', subject, sub, chip, state = 'default', variant = 'card', first = false, to, onPress, copy,
  className,
}: GradeSubjectButtonProps) {
  const words = { ...TEACHER_UI_COPY, ...copy };
  const selected = state === 'selected';
  const disabled = state === 'disabled';
  const box = cn(
    'flex w-full min-h-[76px] items-center gap-3 text-start text-[#1d2025]',
    variant === 'row'
      ? cn('px-3 py-2.5', !first && ROW_DIVIDER, selected ? ROW_SELECTED : 'bg-transparent')
      : selected ? cn(CARD_SELECTED, 'px-[11px] py-[9px]') : cn(CARD, 'px-3 py-2.5'),
    disabled ? 'cursor-default opacity-[.45]' : 'cursor-pointer',
    FOCUS,
    className,
  );
  const inner = (
    <>
      <SubjectTile subject={subject} tone={selected ? 'selected' : disabled ? 'dim' : 'neutral'} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={ROW_TITLE}>{gradeSubjectLabel(grade, subject, section, words.grade)}</span>
        {sub ? <span className={ROW_SUB}>{sub}</span> : null}
      </span>
      {chip?.text ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
      {selected ? (
        <span role="img" aria-label={words.selected} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-white">
          <Check className="h-4 w-4" strokeWidth={3.2} aria-hidden="true" />
        </span>
      ) : null}
      {!selected && !disabled ? <ChevronRight data-chevron className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" /> : null}
    </>
  );
  if (to && !disabled) {
    return <Link to={to} className={box}>{inner}</Link>;
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={() => { if (!disabled) onPress?.(); }}
      className={box}
    >
      {inner}
    </button>
  );
}
