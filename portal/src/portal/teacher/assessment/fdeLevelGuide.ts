/**
 * ICT sheet, Assessment Generator row 7 point 7 (Hashir, RM; Amena 21 Nov 2026): FDE's expected thinking-level mix for a
 * Grade 1-5 paper, shown in the editor beside the paper's own mix. Guidance only: it never blocks a choice.
 *
 * Shares of MARKS (as FDE's tables state them), in three bands: Apply takes Apply, Analyze/Evaluate and Create, as FDE's
 * Grade 1-3 tables group them and the Grade 1-5 papers are tagged.
 *   Grades 1-4: FDE Assessment Scheme 2023-24 and the per-subject Tables of Specification FDE shared (Drive "Class-I..IV").
 *               A subject's own table wins; Maths tables give no headline split, so Maths takes the Scheme's.
 *   Grade 5:    the Table of Specifications printed for each subject in FDE's Grade V model papers (CAE 2026).
 * A grade/subject FDE gave no table for has no guide (null), never a made-up one.
 */

export type Guide = { Remember: number; Understand: number; Apply: number; source: string };
type Mix = [number, number, number];

const SCHEME = 'FDE Assessment Scheme 2023-24';
const TOS = 'FDE Table of Specification 2023-24';
const G5 = 'FDE Grade V model papers, CAE 2026';

const TABLE: Record<number, Record<string, [Mix, string]>> = {
  1: {
    maths: [[20, 50, 30], SCHEME], english: [[40, 40, 20], TOS], urdu: [[40, 40, 20], TOS],
    general_knowledge: [[40, 40, 20], TOS], islamiat: [[40, 40, 20], TOS],
  },
  2: {
    maths: [[20, 50, 30], SCHEME], english: [[40, 40, 20], TOS], urdu: [[40, 40, 20], TOS],
    general_knowledge: [[40, 40, 20], TOS], islamiat: [[40, 40, 20], TOS],
  },
  3: {
    maths: [[20, 50, 30], SCHEME], english: [[30, 30, 40], TOS], urdu: [[40, 30, 30], TOS],
    general_knowledge: [[41, 41, 18], TOS], islamiat: [[40, 30, 30], TOS],
  },
  4: {
    maths: [[10, 60, 30], SCHEME], english: [[30, 30, 40], TOS], urdu: [[30, 30, 40], TOS],
    science: [[30, 30, 40], TOS], social_studies: [[35, 30, 35], TOS], islamiat: [[40, 30, 30], TOS],
  },
  5: {
    maths: [[10, 50, 40], G5], science: [[30, 30, 40], G5], english: [[40, 30, 30], G5],
    urdu: [[30, 30, 40], G5], social_studies: [[30, 40, 30], G5], islamiat: [[40, 30, 30], G5],
  },
};

const ALIAS: Record<string, string> = {
  math: 'maths', mathematics: 'maths', eng: 'english', gensci: 'science', general_science: 'science',
  genk: 'general_knowledge', sst: 'social_studies', social_studies_en: 'social_studies',
  general_knowledge_en: 'general_knowledge',
};

/** FDE's expected mix for this grade and subject, or null when FDE gave none. */
export function fdeGuide(grade: number | null | undefined, subject: string | null | undefined): Guide | null {
  const key = String(subject ?? '').trim().toLowerCase();
  const hit = TABLE[Number(grade)]?.[ALIAS[key] ?? key];
  if (!hit) return null;
  const [[r, u, a], source] = hit;
  return { Remember: r, Understand: u, Apply: a, source };
}

const BAND: Record<string, 'Remember' | 'Understand' | 'Apply'> = {
  remember: 'Remember', understand: 'Understand',
  apply: 'Apply', analyze: 'Apply', analyse: 'Apply', evaluate: 'Apply', create: 'Apply',
};

/** The paper's own mix in the same three bands, by marks; null when no tagged question carries marks. */
export function marksMix(rows: { blooms?: string | null; marks?: number | null }[]) {
  const sum = { Remember: 0, Understand: 0, Apply: 0 };
  for (const r of rows) {
    const band = BAND[String(r.blooms ?? '').trim().toLowerCase()];
    const m = Number(r.marks) || 0;
    if (band && m > 0) sum[band] += m;
  }
  const total = sum.Remember + sum.Understand + sum.Apply;
  if (!total) return null;
  const pct = (n: number) => Math.round((n / total) * 100);
  return { Remember: pct(sum.Remember), Understand: pct(sum.Understand), Apply: pct(sum.Apply) };
}
