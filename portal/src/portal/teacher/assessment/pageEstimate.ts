import { chosenSeenTypes, chosenTypes, isFde, seenByType, type Picks } from './model';

/**
 * bd-nr8mrm.8 — FEAT-209: about how many A4 pages her questions need at the bot's TIGHTEST print step (compact, two
 * columns, trimmed lines), so Check and make can say so before the paper is made.
 *
 * The numbers are measured, not guessed: scripts/assessment/page-estimate/calibrate.js rendered 381 real plain papers
 * through the bot's own renderer and counted their PDF pages; fit.js fitted height = base + Σ count × height-per-type.
 * Held out (5-fold): exact page count 73%, within one page 97%. Re-run both scripts to refresh these numbers.
 * A type seen in too few papers to measure uses its kind's default.
 */
const BASE = 661;
const PAGE = 1040;
const PER_TYPE: Record<string, number> = {
  'Brief Answers': 69, 'Circle the Correct Answer': 67, 'Comprehension Passage': 212, 'Fill in the blanks': 17,
  'Fill in the Blanks': 17, 'Long Questions': 269, MCQs: 51, MSQs: 85, 'Match the Column': 127, 'Mind Map': 172,
  'Paragraph Writing': 263, 'Restricted Response Question': 98, 'Rewrite Sentences': 14, 'Short Questions': 61,
  'Story Writing': 517, 'True/False': 43, 'Word Problems': 79,
};
const OBJECTIVE = 28;
const SUBJECTIVE = 109;
/** Nastaliq lines are taller: this much more per question on an Urdu-script paper. */
const URDU_PER_Q = 16;
const URDU_SUBJECTS = new Set(['urdu', 'islamiat', 'pakistan_studies_ur']);
/** Seen questions counted in one box carry no type: the book's own questions, measured like short questions. */
const SEEN_UNTYPED = 'Short Questions';

/**
 * Pages her questions need, or null when there is nothing to estimate (no questions, or a board pattern the bot does
 * not fit). An unmeasured type counts as subjective unless `isObjective` says otherwise (the bigger guess).
 */
export function estimatePages(
  p: Picks,
  isObjective: (typeId: string) => boolean = () => false,
): number | null {
  if (isFde(p)) return null;
  const seen = seenByType(p) ? chosenSeenTypes(p) : (p.seen > 0 ? [[SEEN_UNTYPED, p.seen] as [string, number]] : []);
  const rows = [...chosenTypes(p), ...seen];
  const total = rows.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  const urdu = URDU_SUBJECTS.has(p.subject ?? '') ? URDU_PER_Q * total : 0;
  const height = rows.reduce((s, [id, n]) => s + n * (PER_TYPE[id] ?? (isObjective(id) ? OBJECTIVE : SUBJECTIVE)), BASE + urdu);
  return Math.max(1, Math.ceil(height / PAGE));
}
