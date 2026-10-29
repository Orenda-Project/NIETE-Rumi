/**
 * Made-up answers in the School card API's shapes, for the tests only (never imported by the app). Every name, code and
 * number is invented. "Today" is Wednesday 28 October 2026: This week has three school days so far, Thu and Fri ahead.
 */
import type { Bucket, CoachingData, CoachingSummary, FeatureGridData, ItemsData, Period, SchoolCardData, SessionReportData, TeacherCardData } from "./types";

export const EMIS = "E-900";
export const EXT = "900000000001";
export const SESSION = "s-100";

const day = (date: string, future = false): Bucket => ({ key: date, label: date, date, future, partial: false });

export const WEEK: Period = {
  key: "week", from: "2026-10-26", to: "2026-10-28", today: "2026-10-28", schoolDaysSoFar: 3,
  buckets: [day("2026-10-26"), day("2026-10-27"), day("2026-10-28"), day("2026-10-29", true), day("2026-10-30", true)],
};
export const MONTH: Period = {
  key: "month", from: "2026-10-01", to: "2026-10-28", today: "2026-10-28", schoolDaysSoFar: 20,
  buckets: ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((d, i) => ({ ...day(d), partial: i === 0 || i === 4 })),
};
export const TODAY: Period = { key: "today", from: "2026-10-28", to: "2026-10-28", today: "2026-10-28", schoolDaysSoFar: 1, buckets: [] };

const NAMES = ["Teacher Alpha", "Teacher Bravo", "Teacher Charlie", "Teacher Delta", "Teacher Echo", "Teacher Foxtrot", "Teacher Golf",
  "Teacher Hotel", "Teacher India", "Teacher Juliet", "Teacher Kilo", "Teacher Lima"];
const ext = (i: number) => `9000000000${String(i + 1).padStart(2, "0")}`;
// Seven teachers with something this week, five with nothing.
const COUNTS = [[6, 3, 2, 2], [5, 2, 1, 1], [3, 1, 1, 1], [4, 1, 0, 0], [3, 1, 0, 1], [2, 0, 0, 0], [3, 1, 2, 0]];

export function schoolCard(period: Period = WEEK): SchoolCardData {
  const totalAll = COUNTS.reduce((n, c) => n + c.reduce((a, b) => a + b, 0), 0);
  return {
    school: { emis: EMIS, name: "Model School Nine", teachers: NAMES.length, lastVisitDaysAgo: 1 },
    period,
    tiles: period.key === "today"
      ? [
        { feature: "lp", total: 8, makers: 5, perDay: null, series: [] },
        { feature: "dc", total: 2, makers: 2, perDay: null, series: [] },
        { feature: "training", total: 0, makers: 0, perDay: null, series: [] },
        { feature: "papers", total: null, makers: null, perDay: null, series: [] },
      ]
      : [
        { feature: "lp", total: 27, makers: 8, perDay: 9, series: [11, 8, 8, 0, 0] },
        { feature: "dc", total: 9, makers: 6, perDay: 3, series: [3, 4, 2, 0, 0] },
        { feature: "training", total: 1, makers: 1, perDay: 0, series: [0, 1, 0, 0, 0] },
        // Did not load: the tile says "—", never 0.
        { feature: "papers", total: null, makers: null, perDay: null, series: [null, null, null, null, null] },
      ],
    teachers: NAMES.map((name, i) => {
      const c = COUNTS[i] ?? [0, 0, 0, 0];
      const total = c.reduce((a, b) => a + b, 0);
      return {
        teacherExtId: ext(i), name, counts: { lp: c[0], dc: c[1], training: c[2], papers: c[3] }, total,
        contributionPct: total > 0 ? Math.round((total / totalAll) * 100) : null, star: i < 2, lastVisitDaysAgo: i === 9 ? null : i + 1,
      };
    }),
    coachObservations: {
      count: 3,
      teachers: [
        { teacherExtId: ext(1), name: NAMES[1], count: 2, points: [{ date: "2026-10-26", score: 64 }, { date: "2026-10-28", score: 71 }], latest: 71, change: 7 },
        { teacherExtId: ext(3), name: NAMES[3], count: 1, points: [{ date: "2026-10-27", score: 59 }], latest: 59, change: null },
      ],
    },
  };
}

export function grid(period: Period = WEEK): FeatureGridData {
  const rows = NAMES.map((name, i) => {
    const c = i < 7 ? [[2, 2, 2], [2, 1, 2], [1, 1, 1], [1, 1, 2], [2, 1, 0], [1, 0, 1], [0, 1, 0]][i] : [0, 0, 0];
    return { teacherExtId: ext(i), name, cells: [...c, null, null], total: c.reduce((a, b) => a + b, 0) };
  });
  // Server order on purpose NOT sorted: the page sorts.
  const shuffled = [rows[8], rows[2], rows[0], rows[11], rows[1], rows[6], rows[3], rows[9], rows[4], rows[5], rows[10], rows[7]];
  return { feature: "lp", period, rows: shuffled, school: [9, 7, 8, null, null], total: 24 };
}

/** Her DC reports and coach visits this week: two of each; one visit on the field form (counted, never scored). */
export const COACHING_SUMMARY: CoachingSummary = { dc: { count: 2, avg: 61, prevAvg: 57 }, coach: { count: 2, avg: 60, prevAvg: null } };
const CHART: TeacherCardData["chart"] = [
  { kind: "dc", id: SESSION, date: "2026-10-26", score: 58 },
  { kind: "coach", id: "v-1", date: "2026-10-27", score: 60 },
  { kind: "dc", id: "s-101", date: "2026-10-28", score: 67 },
];

export function teacherCard(period: Period = WEEK): TeacherCardData {
  return {
    teacher: { teacherExtId: EXT, name: NAMES[0], school: "Model School Nine", emis: EMIS },
    period,
    tiles: {
      lp: { count: 6, series: [2, 2, 2, null, null] },
      papers: { count: 2, series: [1, 0, 1, null, null] },
      training: { parts: 2, courses: 1, series: [0, 2, 0, null, null] },
      days: { withUse: 3, schoolDays: 3 },
    },
    summary: COACHING_SUMMARY,
    chart: CHART,
  };
}

/** The Coaching page, as the server sends it: newest first, both kinds mixed. */
export function coaching(period: Period = WEEK): CoachingData {
  return {
    teacher: { teacherExtId: EXT, name: NAMES[0], school: "Model School Nine", emis: EMIS },
    period,
    summary: COACHING_SUMMARY,
    chart: CHART,
    items: [
      // No topic and no real lesson label: the page titles it "Math lesson".
      { kind: "dc", id: "s-101", date: "2026-10-28", grade: "3", subject: "Mathematics", title: null, score: 67, quote: "Give students two minutes to talk in pairs.", sections: { B: 73, C: 65, D: 54, F: 79 }, coachName: null, form: null },
      { kind: "coach", id: "v-1", date: "2026-10-27", grade: "4", subject: "English", title: "Unitary Method", score: 60, quote: "Use pair talk once in every lesson this week.", sections: { B: 56, C: 54, D: 48, F: 74 }, coachName: "Coach Zulu", form: "v3" },
      { kind: "dc", id: SESSION, date: "2026-10-26", grade: "3", subject: "Mathematics", title: "Fractions · Halves", score: 58, quote: "Call on children in the back rows by name.", sections: { B: null, C: 63, D: 57, F: 75 }, coachName: null, form: null },
      // The field form: counted and listed, no score, no sections.
      { kind: "coach", id: "v-2", date: "2026-10-26", grade: "4", subject: "English", title: null, score: null, quote: null, sections: { B: null, C: null, D: null, F: null }, coachName: "Coach Zulu", form: "observe2" },
    ],
  };
}
export const NO_COACHING: CoachingData = {
  ...coaching(TODAY),
  summary: { dc: { count: 0, avg: null, prevAvg: null }, coach: { count: 0, avg: null, prevAvg: null } },
  chart: [],
  items: [],
};

export const TRAINING_ITEMS: ItemsData = {
  courses: [{ name: "Course One", done: false, parts: [{ name: "Part A", doneAt: "2026-10-27" }, { name: "Part B", doneAt: null }] }],
};

export const SESSION_REPORT: SessionReportData = {
  teacher: { teacherExtId: EXT, name: NAMES[0] },
  date: "2026-10-26", grade: 3, subject: "Mathematics", overall: 67,
  whatWentWell: ["You explained halves and quarters correctly."],
  nextStep: "Give students two minutes to discuss in pairs.",
  sections: [{ code: "B", name: "Lesson Plan Fidelity", pct: 73 }, { code: "C", name: "High-Leverage Practices", pct: 65 }],
  practices: [
    { id: "B1", name: "Instructional Clarity", section: "B", score: 2, scaleMax: 2 },
    { id: "C1", name: "Quality Questioning", section: "C", score: 1, scaleMax: 2 },
    { id: "F6", name: "Subject-Specific Pedagogy: SCIENCE", section: "F", score: null, scaleMax: 2 },
  ],
  lpSteps: [
    { step: "Warm-up", verdict: "executed", text: "Ask the class to count to 20", mustHappen: true },
    { step: "Pair practice", verdict: "not_done", text: "Pairs fold a paper in half", mustHappen: false },
    { step: "Exit ticket", verdict: "not_adjudicable", text: "Three questions on a slip", mustHappen: false },
  ],
  reflection: [{ question: "What went well?", answer: "The explanation went well." }],
};
