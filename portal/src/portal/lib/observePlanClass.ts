/**
 * bd-o15qnr.33 — Check and send's class answer as a filter for the plans offered with it (the operator, 21 Nov: "when
 * selecting a lesson plan, it should have already filtered down to that subject grades Lesson Plans. In both, Recent ones
 * or Library").
 *
 * The answer is the class question's own state: "primary" (Grade 1-5, no subject asked), or a grade 6-12 and, for the
 * grades that ask it (6-8), a subject key of the question's list (english, urdu, maths, science, social_studies, islamiat,
 * computer, other). The observed teacher's recent plans already carry a grade and a subject, each spelled by its source
 * (a download: "Mathematics", "Maths"; a K-5 lesson: "math", "general_science"; her own plan: "english"), so a plan's
 * subject is folded to the question's keys before it is compared. The folding follows the bot's
 * coaching/subject-resolution.js aliases and config/lp612-subject-order.js spellings; first match wins, so
 * "Computer Science" is computer and "General Science" science. A spelling it does not know matches no subject key
 * (never the nearest one), so such a plan shows only when no subject is asked.
 *
 * Filtering is on the client: the recent list already holds the newest plans (the server's cap is 8, the WhatsApp list's),
 * so a class with fewer of its own among those shows fewer, never another class's.
 */

export type PlanClass = { grades: number[]; subject: string | null };

const PRIMARY = [1, 2, 3, 4, 5];

/** The class question's answer → a filter, or null when nothing is chosen (then nothing is filtered). */
export function planClassOf(grade: string | null | undefined, subject: string | null | undefined): PlanClass | null {
  if (!grade) return null;
  if (grade === "primary") return { grades: PRIMARY, subject: null };
  const g = Number(grade);
  if (!Number.isInteger(g) || g < 1 || g > 12) return null;
  // "Other" names no subject a plan could be matched to: the grade alone.
  return { grades: [g], subject: subject && subject !== "other" ? subject : null };
}

/** A plan's grade, however it came: 4, "4", "grade_4", "Grade 4". Anything else is no grade. */
export function gradeOf(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : null;
  const m = /^(?:grade[_\s]*)?(\d{1,2})$/i.exec(String(raw ?? "").trim());
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

const SUBJECT_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["computer", /computer|کمپیوٹر/],
  ["english", /english|انگریزی/],
  ["urdu", /urdu|اردو/],
  ["maths", /\bmath|numeracy|ریاضی/],
  ["islamiat", /islam|اسلامیات/],
  ["social_studies", /social|pak(istan)?\.? ?st|history|geography|civics|معاشرتی|مطالعہ پاکستان/],
  ["science", /science|سائنس/],
];

/** A subject, however spelled, as the class question's key; null when it is none of them. */
export function subjectKeyOf(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").toLowerCase().replace(/_/g, " ").trim();
  if (!s) return null;
  const hit = SUBJECT_RULES.find(([, rx]) => rx.test(s));
  return hit ? hit[0] : null;
}

type Classed = { grade: string | number | null; subject: string | null };

/** Is this plan the class's? Its grade must be one of the class's; its subject, when the class names one, that one. */
export function inClass(p: Classed, cls: PlanClass): boolean {
  const g = gradeOf(p.grade);
  if (g == null || !cls.grades.includes(g)) return false;
  return cls.subject == null || subjectKeyOf(p.subject) === cls.subject;
}

/** The newest `n` plans of the class, in the order given (the server's: newest first); no class, the newest `n`. */
export function recentForClass<T extends Classed>(plans: readonly T[], cls: PlanClass | null, n = 3): T[] {
  return (cls ? plans.filter((p) => inClass(p, cls)) : [...plans]).slice(0, n);
}
