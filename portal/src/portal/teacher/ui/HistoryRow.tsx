import { ChevronRight, Download, School } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useLang } from '../i18n';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { StatusChip } from './StatusChip';
import { CHEVRON, FOCUS, ROW_DIVIDER, ROW_SELECTED, ROW_SUB, ROW_TITLE, type ChipData } from './styles';
import { gradeColoursFor } from './gradeColours';
import { subjectShort } from './subjects';
import { SubjectTile } from './SubjectTile';
import { TimeStamp, type TimeTone } from './TimeStamp';

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
 * COACH rows (bd-4404s7.1, COACH.md §0b): `lead="person"` and `lead="school"` replace that column with a ROUND 48px avatar
 * inset from the edge (initials, a school glyph, or a short `leadText` such as "87%", "HITL", "DC"), grey with ink so it can
 * never be mistaken for the square grade·subject column, which is reserved for a grade and a subject. `time` puts a TimeStamp
 * on the first line, above the title. `state` is `next` (the coming visit: tint and a 3px start bar) or `done` (muted).
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

/** The kit's grade·subject column (the default), or a coach's round avatar. */
export type HistoryLead = 'grade' | 'person' | 'school';
export type HistoryLeadTone = 'grey' | 'indigo' | 'green' | 'amber';
export type HistoryRowState = 'default' | 'next' | 'done';

const AVATAR_TONE: Record<HistoryLeadTone, string> = {
  grey: 'bg-[#e8e9f0] text-[#33374a]',
  indigo: 'bg-[#33374a] text-white',
  green: 'bg-[#eaf6ef] text-[#2f7a52]',
  amber: 'bg-[#fef3c7] text-[#b45309]',
};

/** "Ayesha Bibi" → "AB"; one word → its first letter. */
function initialsOf(name: string): string {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '·';
  return (Array.from(w[0])[0] + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase();
}

export interface HistoryRowProps {
  /** Which lead: the grade·subject column (default) or a coach's round avatar. */
  lead?: HistoryLead;
  /** Avatar text instead of her initials ("87%", "HITL", "DC"). */
  leadText?: string;
  leadTone?: HistoryLeadTone;
  /** What a screen reader hears for the avatar ("Score 87%"); the avatar itself is decorative. */
  leadLabel?: string;
  /** A time of day on the first line ("08:30" or "8:30 AM"), drawn by TimeStamp. */
  time?: string | null;
  timeTone?: TimeTone;
  /** `next` = the coming visit (tint, 3px start bar); `done` = muted. */
  state?: HistoryRowState;
  /** The grade·subject lead's subject (not used by the coach leads). */
  subject?: string;
  /** Absent, empty or a dash placeholder when the grade was never settled: the lead shows the subject alone. */
  grade?: string | number | null;
  title: string;
  /** Let a long title wrap in full (a school's long name) instead of the 2-line clamp. */
  wrapTitle?: boolean;
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
  lead = 'grade', leadText, leadTone = 'grey', leadLabel, time, timeTone, state = 'default',
  subject = '', grade, title, wrapTitle = false, extra, chip, action = 'chevron', to, isNew = false, first = true, onAction, copy,
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
      {lead === 'grade' ? (
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
      ) : (
        <span
          aria-hidden="true"
          data-testid="history-avatar"
          className={cn('ms-3.5 flex h-12 w-12 shrink-0 items-center justify-center whitespace-nowrap rounded-full text-[16px] font-bold leading-none', AVATAR_TONE[leadTone] ?? AVATAR_TONE.grey)}
        >
          {lead === 'school'
            ? <School className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
            : bidi(leadText ?? initialsOf(title))}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-[3px] py-2.5">
        {lead === 'grade' && spoken ? <span className="sr-only">{bidi(spoken)}</span> : null}
        {lead !== 'grade' && leadLabel ? <span className="sr-only">{bidi(leadLabel)}</span> : null}
        {time ? <TimeStamp time={time} tone={timeTone ?? (state === 'next' ? 'next' : state === 'done' ? 'done' : 'neutral')} size={15} /> : null}
        <span className={cn(ROW_TITLE, wrapTitle ? '[overflow-wrap:anywhere]' : 'line-clamp-2', state === 'done' && 'text-[#6b7280]')}>{bidi(title)}</span>
        {extra ? <span className={ROW_SUB}>{bidi(extra)}</span> : null}
      </span>
      {isNew ? <span role="img" aria-label={words.newItem} className="h-[9px] w-[9px] shrink-0 rounded-full bg-[#c8331f]" /> : null}
      {chip?.text ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
    </>
  );
  return (
    <div data-history-row className={cn('w-full text-[#1d2025]', state === 'next' ? ROW_SELECTED : state === 'done' ? 'bg-[#f9fafb]' : 'bg-white', !first && ROW_DIVIDER)}>
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
