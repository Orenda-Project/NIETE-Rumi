import { TEACHER_UI_COPY } from './copy';
import type { CopyEntry } from '../copyRegistry';
import type { Lang } from '../i18n';

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

/** The subject families the history row lead is coloured by (PROVISIONAL — HistoryRow.tsx `leadColours`). */
export type SubjectFamily = 'languages' | 'maths' | 'sciences' | 'computer' | 'humanities';

export interface SubjectShortForm {
  /** Stable name for the review file and the copy checks ("subjectShort.science"). */
  key: string;
  match: RegExp;
  /** English short form: no period, never wrapped or cut (operator, 9 Oct: "short form without a period, e.g. SST/Sci/Math"). */
  en: string;
  /** Urdu short form: ONE word, MACHINE-DRAFTED (review pending) — the bot's own subject names, shortened. */
  ur: string;
  family: SubjectFamily;
}

/**
 * bd-fmf24g.16 — the D6.5 history row lead's subject half, ported from the v28 canvas (HistoryRow.dc.html `pick()`,
 * lead `splitstack`). First match wins, as `subjectIcon`: "Computer Science" is Comp, "General Science" Sci.
 *
 * English is drawn at 15px/700 and fits the 64px column with room to spare ("Pak St" ≈ 46–54px across the sans
 * stack). Urdu is drawn at 13px/700 in Noto Nastaliq Urdu: every word below measures ≤ 50px wide and ≤ 32px tall
 * (اسلامیات 50, طبیعیات 44, معلومات 43, زراعت 42; کمپیوٹر and پاکستان the tallest), so it fits the column and its
 * 38px half. The Urdu takes the bot's own names (lp612-subject-order.js, teacher-report.page.js) and keeps the
 * first word of a two-word one — مطالعہ پاکستان → پاکستان, معاشرتی علوم → معاشرتی, معلومات عامہ → معلومات,
 * مذہبی تعلیم → مذہبی — because the full names are 65–71px at 13px.
 */
export const SUBJECT_SHORT: readonly SubjectShortForm[] = [
  { key: 'english', match: /english/, en: 'Eng', ur: 'انگریزی', family: 'languages' },
  { key: 'urdu', match: /urdu|اردو/, en: 'Urdu', ur: 'اردو', family: 'languages' },
  { key: 'maths', match: /math/, en: 'Math', ur: 'ریاضی', family: 'maths' },
  { key: 'computer', match: /computer/, en: 'Comp', ur: 'کمپیوٹر', family: 'computer' },
  { key: 'physics', match: /physics/, en: 'Phy', ur: 'طبیعیات', family: 'sciences' },
  { key: 'chemistry', match: /chemistry/, en: 'Chem', ur: 'کیمیا', family: 'sciences' },
  { key: 'biology', match: /biology/, en: 'Bio', ur: 'حیاتیات', family: 'sciences' },
  { key: 'agriculture', match: /agricultur|zarai/, en: 'Agri', ur: 'زراعت', family: 'sciences' },
  { key: 'generalKnowledge', match: /general knowledge/, en: 'GK', ur: 'معلومات', family: 'humanities' },
  { key: 'science', match: /science/, en: 'Sci', ur: 'سائنس', family: 'sciences' },
  { key: 'religious', match: /religio/, en: 'Rel', ur: 'مذہبی', family: 'humanities' },
  { key: 'pakistanStudies', match: /pakistan/, en: 'Pak St', ur: 'پاکستان', family: 'humanities' },
  { key: 'socialStudies', match: /social/, en: 'SST', ur: 'معاشرتی', family: 'humanities' },
  { key: 'islamiat', match: /islam/, en: 'Isl', ur: 'اسلامیات', family: 'humanities' },
  { key: 'geography', match: /geograph/, en: 'Geo', ur: 'جغرافیہ', family: 'humanities' },
  { key: 'history', match: /history/, en: 'Hist', ur: 'تاریخ', family: 'humanities' },
];

function shortForm(subject: string | null | undefined): SubjectShortForm | undefined {
  const s = String(subject ?? '').toLowerCase();
  return SUBJECT_SHORT.find((r) => r.match.test(s));
}

/**
 * The lead's subject half: the short form in the page's language; anything else, its first word cut to 4 letters
 * (in Urdu too — a Latin atom the kit's bidi egress isolates).
 */
export function subjectShort(subject: string | null | undefined, lang: Lang = 'en'): string {
  const row = shortForm(subject);
  if (row) return lang === 'ur' ? row.ur : row.en;
  const first = String(subject ?? '').trim().split(/\s+/)[0] || '';
  return [...first].slice(0, 4).join('');
}

/** languages · maths · sciences (physics, chemistry, biology, agriculture too) · computer · humanities (and anything else). */
export function subjectFamily(subject: string | null | undefined): SubjectFamily {
  return shortForm(subject)?.family ?? 'humanities';
}

/**
 * The Urdu short forms go through the same completeness checks and review file as every other Urdu word
 * (copyRegistry). Registered by ui/copy.ts (COPY_ENTRIES), as a feature's copy.ts registers itself.
 */
export const SUBJECT_SHORT_ENTRIES: readonly CopyEntry[] = [{
  screen: 'kit (shared components)',
  module: {
    en: { subjectShort: Object.fromEntries(SUBJECT_SHORT.map((r) => [r.key, r.en])) },
    ur: { subjectShort: Object.fromEntries(SUBJECT_SHORT.map((r) => [r.key, r.ur])) },
  },
}];

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
