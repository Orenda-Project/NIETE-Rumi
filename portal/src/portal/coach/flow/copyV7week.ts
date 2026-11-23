/**
 * bd-o15qnr.28.1 (queue #204, v7) — the words v7's week page, Home's Monday "Your week" and My progress add (#188's
 * canvas boards c8-week-page, c8-home-monday, c8-progress, c8-progress-ur). Words already in the app are reused from their
 * own files: report/copy.ts (Weekly report, n of t, Open Module, Steady strengths, Keep in mind, See the full week, Just
 * for you) and flow/copyV7.ts (Key Focus Area, Respect held and its note, Observations, the status line's step words).
 * Counts, never a % (the operator, 20 Nov 15:04). Never him or her for a teacher. Urdu MACHINE-DRAFTED: NATIVE-CHECK.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";

export const FLOW_V7_WEEK_COPY = {
  /* My progress (the Home tile and the page) */
  progressTitle: "My progress",
  thisWeek: "This week",
  completeObs: "complete observations",
  goal: (n: number, of: number) => `Goal ${n} of ${of}`,
  behavioursLast: (n: number) => `Your behaviours, last ${n} debriefs`,
  seeAll: "See all observations",
  weeklyReports: "Weekly reports",
  noObservations: "No observations yet",
  noDebriefs: "No debriefs yet",
  noWeeks: "No weekly reports yet",

  /* Home on Monday, and the week page */
  yourWeek: (span: string) => `Your week · ${span}`,
  dayByDay: "This week, day by day",
} as const;

export type FlowV7WeekCopy = Words<typeof FLOW_V7_WEEK_COPY>;

// NATIVE-CHECK (bd-o15qnr.28.1, machine-drafted; #188's c8-progress-ur board words where it had them)
export const FLOW_V7_WEEK_COPY_UR: FlowV7WeekCopy = {
  progressTitle: "میری پیش رفت",
  thisWeek: "اس ہفتے",
  completeObs: "مکمل مشاہدات",
  goal: (n: number, of: number) => `ہدف: ${of} میں سے ${n}`,
  behavioursLast: (n: number) => `آپ کے رویے، پچھلی ${n} ڈی بریف`,
  seeAll: "تمام مشاہدات دیکھیں",
  weeklyReports: "ہفتہ وار رپورٹس",
  noObservations: "ابھی کوئی مشاہدہ نہیں",
  noDebriefs: "ابھی کوئی ڈی بریف نہیں",
  noWeeks: "ابھی کوئی ہفتہ وار رپورٹ نہیں",

  yourWeek: (span: string) => `آپ کا ہفتہ · ${span}`,
  dayByDay: "یہ ہفتہ، دن بہ دن",
};

export const FLOW_V7_WEEK = bilingual(FLOW_V7_WEEK_COPY, FLOW_V7_WEEK_COPY_UR);

/** Past the 4-word label rule: words that mirror the boards word for word. */
const LONG_OK: readonly string[] = ["behavioursLast", "dayByDay", "noWeeks", "noDebriefs", "goal"];

export const COPY_ENTRY = { screen: "Coach · week and My progress (v7)", module: FLOW_V7_WEEK as Bilingual<unknown>, same: [] as readonly string[], longOk: LONG_OK } as const;
