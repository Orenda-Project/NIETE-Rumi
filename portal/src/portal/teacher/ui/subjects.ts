import { TEACHER_UI_COPY } from './copy';

/**
 * bd-fmf24g.2.1 — what the kit draws for a subject, from its NAME (the API's subject string, as the WhatsApp
 * bot stores it). Ported from the v28 canvas (SubjectTile.dc.html, HistoryRow.dc.html); COMPONENTS.md has the
 * tables. First match wins, so "Computer Science" is a computer and "General Science" a flask.
 */

export type SubjectIconKey =
  | 'en' | 'ur' | 'calc' | 'monitor' | 'atom' | 'tube' | 'sprout' | 'wheat' | 'flask' | 'bulb' | 'globe'
  | 'bookmark' | 'scroll' | 'landmark' | 'book';

export function subjectIcon(subject: string | null | undefined): SubjectIconKey {
  const s = String(subject ?? '').toLowerCase();
  if (/english/.test(s)) return 'en';
  if (/urdu|اردو/.test(s)) return 'ur';
  if (/math/.test(s)) return 'calc';
  if (/computer/.test(s)) return 'monitor';
  if (/physics/.test(s)) return 'atom';
  if (/chemistry/.test(s)) return 'tube';
  if (/biology/.test(s)) return 'sprout';
  if (/agricultur|zarai/.test(s)) return 'wheat';
  if (/science/.test(s)) return 'flask';
  if (/general knowledge/.test(s)) return 'bulb';
  if (/geography/.test(s)) return 'globe';
  if (/islam|religio|quran|seerah/.test(s)) return 'bookmark';
  if (/history/.test(s)) return 'scroll';
  if (/pakistan|social|civics/.test(s)) return 'landmark';
  return 'book';
}

/** English and Urdu are letters in the tile, not a drawing. */
export const SUBJECT_GLYPH: Partial<Record<SubjectIconKey, string>> = { en: 'Aa', ur: 'اب' };

/**
 * The block lead's subject line (operator, 8 Oct): Title Case and about as long as "Grade 10" — the full name when
 * it fits the 96px block at 16px/700, otherwise a longer abbreviation whose every abbreviated word ends in a
 * period. Never wrapped, never an ellipsis. Anything else: its first word if ≤ 8 letters, else 6 letters + ".".
 */
export function blockSubject(subject: string | null | undefined): string {
  const raw = String(subject ?? '').trim();
  const s = raw.toLowerCase();
  if (/english/.test(s)) return 'English';
  if (/urdu|اردو/.test(s)) return 'Urdu';
  if (/math/.test(s)) return 'Maths';
  if (/computer/.test(s)) return 'Computer';
  if (/physics/.test(s)) return 'Physics';
  if (/chemistry/.test(s)) return 'Chemistry';
  if (/biology/.test(s)) return 'Biology';
  if (/agricultur|zarai/.test(s)) return 'Agricul.';
  if (/general knowledge/.test(s)) return 'Gen. Kn.';
  if (/science/.test(s)) return 'Science';
  if (/religio/.test(s)) return 'Religion';
  if (/pakistan/.test(s)) return 'Pak. St.';
  if (/social/.test(s)) return 'Soc. St.';
  if (/islam/.test(s)) return 'Islamiat';
  if (/geograph/.test(s)) return 'Geogr.';
  if (/history/.test(s)) return 'History';
  const first = raw.split(/\s+/)[0] || raw;
  return first.length <= 8 ? first : `${first.slice(0, 6)}.`;
}

/** "Grade 4-A · General Science", or the subject alone. */
export function gradeSubjectLabel(
  grade: string | number | null | undefined,
  subject: string,
  section = '',
  gradeWord: (g: string | number) => string = TEACHER_UI_COPY.grade,
): string {
  const g = grade === null || grade === undefined ? '' : String(grade);
  return g ? `${gradeWord(g + (section ? `-${section}` : ''))} · ${subject}` : subject;
}
