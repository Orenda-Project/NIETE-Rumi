import { ChevronRight, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TEACHER_UI_COPY, type TeacherUiCopy } from './copy';
import { StatusChip } from './StatusChip';
import { CHEVRON, FOCUS, ROW_DIVIDER, ROW_SUB, ROW_TITLE, type ChipData } from './styles';
import { blockSubject } from './subjects';
import { SubjectTile } from './SubjectTile';

/**
 * bd-fmf24g.2.1 — HistoryRow (COMPONENTS.md §2): one thing she did — a lesson plan opened, an observation, a paper.
 *
 * Lead = the operator's "block" (8 Oct): a 96px grey block, "Grade 4" over the subject at the SAME 16px/700,
 * never wrapped or cut — the full subject name when it fits, else a longer abbreviation ending in a period
 * (subjects.ts `blockSubject`). The lead carries grade and subject, so line 2 is only the `extra` ("Chap 1").
 * (The canvas's other leads — icon, stacked, badge, tint — are history the operator turned down; not ported.)
 *
 * A grade never settled (bd-fmf24g.11: a DC lesson the analysis left open) — absent, empty, or a dash placeholder
 * ("-", "–", "—") — leaves the block with the subject alone, centred, at the same 16px/700; with no subject either,
 * the SubjectTile book icon. A subject with no grade is never "Grade –".
 *
 * Then the title (16px/600, 2 lines), the red New dot, a chip, and the action:
 *   chevron  the whole row is a link to `to` (with the ›);
 *   download a 56px download button (onAction); the row itself is information;
 *   none     information only (a paper still writing).
 */

export type HistoryAction = 'chevron' | 'download' | 'none';

export interface HistoryRowProps {
  subject: string;
  /** Absent, empty or a dash placeholder when the grade was never settled: the block shows the subject alone. */
  grade?: string | number | null;
  title: string;
  /** Line 2: "Chap 1", "20 questions", the coach's name. */
  extra?: string;
  chip?: ChipData | null;
  action?: HistoryAction;
  /** Where the row goes (chevron action). */
  to?: string;
  /** Not opened yet: the red dot. */
  isNew?: boolean;
  /** The first row in its card has no divider above it. */
  first?: boolean;
  onAction?: () => void;
  copy?: Partial<Pick<TeacherUiCopy, 'grade' | 'download' | 'newItem'>>;
}

export function HistoryRow({
  subject, grade, title, extra, chip, action = 'chevron', to, isNew = false, first = true, onAction, copy,
}: HistoryRowProps) {
  const words = { ...TEACHER_UI_COPY, ...copy };
  const isLink = action === 'chevron' && !!to;
  const g = grade === null || grade === undefined ? '' : String(grade).trim();
  const hasGrade = g !== '' && !/^[-–—]+$/.test(g);
  const hasSubject = !!subject && subject.trim() !== '';
  const body = (
    <>
      <span
        data-testid="history-lead"
        className="flex min-h-[58px] w-24 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-[#f3f4f6] px-[5px] py-[7px] text-center leading-[1.15] text-[#1d2025]"
      >
        {hasGrade ? <span className="whitespace-nowrap text-[16px] font-bold">{words.grade(g)}</span> : null}
        {hasSubject ? <span className="whitespace-nowrap text-[16px] font-bold">{blockSubject(subject)}</span> : null}
        {!hasGrade && !hasSubject ? <SubjectTile subject="" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={cn(ROW_TITLE, 'line-clamp-2')}>{title}</span>
        {extra ? <span className={ROW_SUB}>{extra}</span> : null}
      </span>
      {isNew ? <span role="img" aria-label={words.newItem} className="h-[9px] w-[9px] shrink-0 rounded-full bg-[#c8331f]" /> : null}
      {chip?.text ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
    </>
  );
  return (
    <div data-history-row className={cn('w-full bg-white text-[#1d2025]', !first && ROW_DIVIDER)}>
      {isLink ? (
        <Link to={to as string} className={cn('flex min-h-[76px] w-full items-center gap-3 py-2.5 pe-3.5 ps-3 text-start', FOCUS)}>
          {body}
          <ChevronRight data-chevron className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
        </Link>
      ) : (
        <div className={cn('flex min-h-[76px] items-center gap-3 py-2.5 ps-3', action === 'download' ? 'pe-1.5' : 'pe-3.5')}>
          {body}
          {action === 'download' ? (
            <button
              type="button"
              onClick={() => onAction?.()}
              aria-label={words.download}
              className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] text-[#33374a]', FOCUS)}
            >
              <Download className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
