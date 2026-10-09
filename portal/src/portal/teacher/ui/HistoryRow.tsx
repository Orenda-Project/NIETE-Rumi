import { ChevronRight, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useLang } from '../i18n';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { StatusChip } from './StatusChip';
import { CHEVRON, FOCUS, ROW_DIVIDER, ROW_SUB, ROW_TITLE, type ChipData } from './styles';
import { gradeColoursFor } from './gradeColours';
import { subjectShort } from './subjects';
import { SubjectTile } from './SubjectTile';

/**
 * bd-fmf24g.2.1 / bd-fmf24g.16 — HistoryRow (COMPONENTS.md §2): one thing she did — a lesson plan opened, an
 * observation, a paper.
 *
 * Lead = the operator's D6.5 "section, stacked" (9 Oct: "switch this component everywhere"; it replaced the 8 Oct
 * 96px grey block, which is gone, not an option). Not a chip: a 64px column built into the row, flush with the
 * row's START edge (left in English, right in Urdu — the row has no start or vertical padding of its own), the
 * full row height (76px, more when the title wraps), 12px from the text. The card the row sits in clips it at its
 * rounded corners (LIST_CARD is overflow-hidden; a standalone row's card must be too — RequestPage).
 *   top    "G4" (copy `gradeShort`) 17px/800 tabular, white on the grade's dark colour;
 *   bottom the subject's short form (subjects.ts `subjectShort`: Sci, Math, SST, Pak St — no period, never
 *          wrapped or cut) 15px/700 in the grade's dark colour on its light tint.
 * Urdu (machine-drafted, review pending): the numeral alone on top and one short Urdu word below at 13px
 * (سائنس, ریاضی, انگریزی …); digits and any Latin fallback go through the kit's bidi egress (isolated).
 *
 * The column is visual only (aria-hidden). The row's accessible name carries the words: "Grade 4 General Science"
 * (copy `grade` + the subject as given), a visually hidden span where the lead used to speak.
 *
 * A grade never settled (bd-fmf24g.11: a DC lesson the analysis left open) — absent, empty, or a dash placeholder
 * ("-", "–", "—") — leaves the subject alone, centred on the neutral grey, full height: never "G–". No subject either: the
 * SubjectTile book icon on grey. A grade with no subject: "G4" alone on the dark.
 *
 * Colour is the GRADE's (gradeColours.ts), chosen in ONE place, `leadColours`.
 *
 * Then the title (16px/600, 2 lines), the red New dot, a chip, and the action:
 *   chevron  the whole row is a link to `to` (with the ›);
 *   download a 56px download button (onAction); the row itself is information;
 *   none     information only (a paper still writing).
 */

export type HistoryAction = 'chevron' | 'download' | 'none';

export interface LeadColours {
  /** The subject half's tint. */
  light: string;
  /** The grade half's colour, and the subject's words. */
  dark: string;
}

/**
 * The lead's ONE colour rule: the GRADE (operator, 9 Oct; bd-fmf24g.19) — the table is gradeColours.ts, so other
 * components can use it. No grade: neutral (the subject alone on grey). It takes the whole row for the day a row
 * needs more than the grade.
 */
export function leadColours(row: { subject: string; grade?: string | number | null }): LeadColours {
  return gradeColoursFor(row.grade);
}

export interface HistoryRowProps {
  subject: string;
  /** Absent, empty or a dash placeholder when the grade was never settled: the lead shows the subject alone. */
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
  copy?: Partial<Pick<TeacherUiCopy, 'grade' | 'gradeShort' | 'download' | 'newItem'>>;
}

/** An Urdu word (13px Nastaliq), not a Latin short form (15px). */
const ARABIC_SCRIPT = /[؀-ۿ]/;

export function HistoryRow({
  subject, grade, title, extra, chip, action = 'chevron', to, isNew = false, first = true, onAction, copy,
}: HistoryRowProps) {
  const bidi = useBidi();
  const lang = useLang();
  const words = { ...useKitCopy(), ...copy };
  const isLink = action === 'chevron' && !!to;
  const g = grade === null || grade === undefined ? '' : String(grade).trim();
  const hasGrade = g !== '' && !/^[-–—]+$/.test(g);
  const name = String(subject ?? '').trim();
  const hasSubject = name !== '';
  const short = hasSubject ? subjectShort(name, lang) : '';
  const tint = leadColours({ subject: name, grade: hasGrade ? g : null });
  const spoken = [hasGrade ? words.grade(g) : '', name].filter(Boolean).join(' ');
  const body = (
    <>
      <span
        aria-hidden="true"
        data-testid="history-lead"
        className="flex w-16 shrink-0 flex-col self-stretch overflow-hidden whitespace-nowrap text-center leading-none"
      >
        {hasGrade ? (
          <span
            className="flex flex-1 items-center justify-center text-[17px] font-extrabold tabular-nums text-white"
            style={{ backgroundColor: tint.dark }}
          >
            {bidi(words.gradeShort(g))}
          </span>
        ) : null}
        {hasSubject ? (
          <span
            className={cn('flex flex-1 items-center justify-center font-bold', ARABIC_SCRIPT.test(short) ? 'text-[13px]' : 'text-[15px]')}
            style={{ backgroundColor: tint.light, color: tint.dark }}
          >
            {bidi(short)}
          </span>
        ) : null}
        {!hasGrade && !hasSubject ? (
          <span className="flex flex-1 items-center justify-center bg-[#f3f4f6]">
            <SubjectTile subject="" />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px] py-2.5">
        {spoken ? <span className="sr-only">{bidi(spoken)}</span> : null}
        <span className={cn(ROW_TITLE, 'line-clamp-2')}>{bidi(title)}</span>
        {extra ? <span className={ROW_SUB}>{bidi(extra)}</span> : null}
      </span>
      {isNew ? <span role="img" aria-label={words.newItem} className="h-[9px] w-[9px] shrink-0 rounded-full bg-[#c8331f]" /> : null}
      {chip?.text ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
    </>
  );
  return (
    <div data-history-row className={cn('w-full bg-white text-[#1d2025]', !first && ROW_DIVIDER)}>
      {isLink ? (
        <Link to={to as string} className={cn('flex min-h-[76px] w-full items-center gap-3 pe-3.5 text-start', FOCUS)}>
          {body}
          <ChevronRight data-chevron className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
        </Link>
      ) : (
        <div className={cn('flex min-h-[76px] items-center gap-3', action === 'download' ? 'pe-1.5' : 'pe-3.5')}>
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
