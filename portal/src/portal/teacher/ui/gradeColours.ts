/**
 * bd-fmf24g.19 — the class colours, keyed on the GRADE (operator, 9 Oct; Blueprint "D": the five brighter colours are
 * Grades 1–5, the seven deeper ones Grades 6–12). The ONE colour table for a class in the teacher app: no screen picks
 * a colour of its own, and it never varies — the point is that a teacher learns "G4 is red". The words ("G4", the
 * subject) are always on the tile too; colour never stands alone.
 *
 * Final hexes: NIETE Portal Coaching/workbench/blueprint/subject-colours/grade_palette_final.json.
 * `dark` is the grade half's fill (white text on it) and the subject's ink; `light` is the subject half's tint.
 */

export interface GradeColours {
  /** The grade half's fill, and the subject's ink on its tint. */
  dark: string;
  /** The subject half's tint. */
  light: string;
}

export const GRADE_COLOURS: Readonly<Record<number, GradeColours>> = {
  1: { dark: '#b45309', light: '#faf3ee' },
  2: { dark: '#7c3aed', light: '#efe7fd' },
  3: { dark: '#15803d', light: '#eff6f1' },
  4: { dark: '#c62828', light: '#f8e5e5' },
  5: { dark: '#1e40af', light: '#e4e8f5' },
  6: { dark: '#946200', light: '#f4efe6' },
  7: { dark: '#0e7490', light: '#e2eef2' },
  8: { dark: '#5f6f00', light: '#eceee0' },
  9: { dark: '#881337', light: '#f1e3e7' },
  10: { dark: '#00796b', light: '#e6f2f0' },
  11: { dark: '#6a1b9a', light: '#ede4f3' },
  12: { dark: '#713f12', light: '#eee8e3' },
};

/** No grade (or one off the 1–12 ladder): the subject alone on grey, in the app's indigo ink. */
export const NEUTRAL_COLOURS: GradeColours = { dark: '#33374a', light: '#f3f4f6' };

/** A grade as the API or a screen has it — 4, "4", "G4", "Grade 4" — to its colours; anything else is neutral. */
export function gradeColoursFor(grade: string | number | null | undefined): GradeColours {
  const n = typeof grade === 'number' ? grade : Number(String(grade ?? '').trim().replace(/^(?:grade|g)\s*/i, ''));
  return (Number.isInteger(n) && GRADE_COLOURS[n]) || NEUTRAL_COLOURS;
}
