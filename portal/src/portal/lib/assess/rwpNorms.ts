import type { ReadLang } from './exampleCohort';

/**
 * Reference reading fluency per grade from the Rawalpindi EGRA study (May 2026, one form for grades 1–5, about 420
 * children per grade and language): correct words per minute on the oral reading passage in its first 60 seconds.
 * The dashboard shows these beside the passage card so a group's numbers can be read against a real cohort.
 * zero = the share of children who read no word correctly.
 */

export type GradeNorm = { n: number; median: number; p25: number; p75: number; zero: number };
export type Grade = 1 | 2 | 3 | 4 | 5;

export const RWP_ORF: Record<ReadLang, Record<Grade, GradeNorm>> = {
  ur: {
    1: { n: 419, median: 0, p25: 0, p75: 0, zero: 0.881 },
    2: { n: 439, median: 0, p25: 0, p75: 24, zero: 0.515 },
    3: { n: 420, median: 29, p25: 0, p75: 63.9, zero: 0.279 },
    4: { n: 438, median: 60, p25: 26.2, p75: 96.9, zero: 0.137 },
    5: { n: 421, median: 92.3, p25: 56.7, p75: 120, zero: 0.071 },
  },
  en: {
    1: { n: 411, median: 0, p25: 0, p75: 0, zero: 0.92 },
    2: { n: 438, median: 0, p25: 0, p75: 1.7, zero: 0.744 },
    3: { n: 433, median: 0, p25: 0, p75: 36, zero: 0.557 },
    4: { n: 441, median: 28, p25: 0, p75: 65.9, zero: 0.388 },
    5: { n: 416, median: 54.9, p25: 0, p75: 84.9, zero: 0.262 },
  },
};

export const GRADES: Grade[] = [1, 2, 3, 4, 5];

export function rwpOrf(lang: ReadLang, grade: Grade): GradeNorm | null {
  return RWP_ORF[lang][grade] || null;
}
