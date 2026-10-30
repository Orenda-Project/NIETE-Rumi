/**
 * Made-up answers in the School card API's shapes, for the tests only (never imported by the app). Every name, code and
 * number is invented. "Today" is Wednesday 28 October 2026: This week has three school days so far, Thu and Fri ahead.
 */
import type { Bucket, CoachingSummary, FeatureGridData, ItemsData, Period, SchoolCardData, SchoolScoresData, ScoreKind, SessionReportData, TeacherCardData, TeacherScoresData } from "./types";

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
    scores: period.key === "today"
      ? {
        dc: { count: 0, avg: null, prevAvg: null, makers: 0, points: [], series: [] },
        coach: { count: 0, avg: null, prevAvg: null, makers: 0, points: [], series: [] },
      }
      : {
        dc: { count: 4, avg: 66, prevAvg: 61, makers: 3, points: [], series: period.key === "month" ? [null, 58, 63, 60, 66] : [60, 70, 74, null, null] },
        coach: { count: 2, avg: 68, prevAvg: null, makers: 2, points: [], series: period.key === "month" ? [null, null, 62, null, 68] : [71, 64, null, null, null] },
      },
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
      days: {
        withUse: 2, schoolDays: period.schoolDaysSoFar, used: ["2026-10-26", "2026-10-28"],
        uses: [{ day: "2026-10-26", features: ["lp", "dc", "papers"] }, { day: "2026-10-28", features: ["lp", "training"] }],
        perFeature: { lp: 2, dc: 1, training: 1, papers: 1 },
      },
    },
    summary: COACHING_SUMMARY,
    chart: CHART,
  };
}

/** Her Digital Coaching or Coach observations page: count, average, each scored report, practice averages, her reports. */
export function teacherScores(kind: ScoreKind, period: Period = WEEK): TeacherScoresData {
  const dc = kind === "dc";
  const reports: TeacherScoresData["reports"] = dc
    ? [
      // No topic and no real lesson label: the page titles it "Math lesson".
      { id: "s-101", date: "2026-10-28", grade: "3", subject: "Mathematics", title: null, score: 67, form: null, coachName: null },
      { id: SESSION, date: "2026-10-26", grade: "3", subject: "Mathematics", title: "Types of Fractions", score: 58, form: null, coachName: null },
    ]
    : [
      { id: "v-1", date: "2026-10-27", grade: "4", subject: "English", title: "Unitary Method", score: 60, form: "v3", coachName: "Coach Zulu" },
      // the field form: counted and listed, never averaged
      { id: "v-2", date: "2026-10-26", grade: "4", subject: "English", title: null, score: null, form: "observe2", coachName: "Coach Zulu" },
    ];
  return {
    teacher: { teacherExtId: EXT, name: NAMES[0], school: "Model School Nine", emis: EMIS },
    period,
    kind,
    count: reports.length,
    avg: dc ? 63 : 60,
    prevAvg: dc ? 57 : null,
    series: reports.filter((r) => r.score != null).map((r) => ({ id: r.id, date: r.date, score: r.score as number })).reverse(),
    sections: [
      // B is the plan steps (bd-dgfkgs.3): measured in one of the two reports (DC); never for the coach
      dc
        ? { code: "B", name: "Lesson Plan Fidelity", avg: null, scoredIn: 1, indicators: [], plan: { pct: 75, steps: [
          { step: 1, done: 2, partly: 0, skipped: 0 }, { step: 2, done: 1, partly: 0, skipped: 0 }, { step: 3, done: 0, partly: 1, skipped: 0 },
          { step: 4, done: 1, partly: 0, skipped: 0 }, { step: 5, done: 0, partly: 0, skipped: 1 },
        ] } }
        : { code: "B", name: "Lesson Plan Fidelity", avg: null, scoredIn: 0, indicators: [], plan: null },
      { code: "C", name: "High-Leverage Practices", avg: 1.2, scoredIn: dc ? 2 : 1, indicators: [
        { id: "C1", name: "Quality Questioning (Bloom's Aligned)", avg: 1.4, pct: 70, scaleMax: 2, n: dc ? 2 : 1 },
        { id: "C2", name: "Responsive Re-explanation & Adaptive Teaching", avg: 1, pct: 50, scaleMax: 2, n: dc ? 2 : 1 },
      ] },
      { code: "D", name: "Student Engagement", avg: 0.8, scoredIn: dc ? 2 : 1, indicators: [{ id: "D1", name: "Diversity of Conceptual Expression", avg: 0.8, pct: 40, scaleMax: 2, n: dc ? 2 : 1 }] },
      { code: "F", name: "Teacher Subject Knowledge", avg: 1.6, scoredIn: dc ? 2 : 1, indicators: [{ id: "F1", name: "Content Accuracy", avg: 1.6, pct: 80, scaleMax: 2, n: dc ? 2 : 1 }] },
    ],
    reports,
  };
}
export const NO_SCORES = (kind: ScoreKind): TeacherScoresData => ({ ...teacherScores(kind, TODAY), count: 0, avg: null, prevAvg: null, series: [], sections: [], reports: [] });

/** The school's Digital Coaching (or Coach observations) by teacher, sorted by count, then average. */
export function schoolScores(kind: ScoreKind, period: Period = WEEK): SchoolScoresData {
  return {
    kind,
    period,
    rows: [
      { teacherExtId: ext(0), name: NAMES[0], count: 2, avg: 68, points: [{ id: "s-1", date: "2026-10-26", score: 61 }, { id: "s-2", date: "2026-10-28", score: 74 }] },
      { teacherExtId: ext(1), name: NAMES[1], count: 1, avg: 70, points: [{ id: "s-3", date: "2026-10-27", score: 70 }] },
      { teacherExtId: ext(2), name: NAMES[2], count: 0, avg: null, points: [] },
    ],
    school: { emis: EMIS, name: "Model School Nine", teachers: 3, count: 3, avg: 69, makers: 2 },
  };
}

/** A coach observation in the report view (any coach; reviewed). */
export const VISIT_REPORT: SessionReportData = {
  kind: "coach", coachName: "Coach Zulu", form: "v3", reviewed: true,
  teacher: { teacherExtId: EXT, name: NAMES[0] },
  date: "2026-10-27", grade: 4, subject: "English", overall: 60,
  whatWentWell: ["Clear instructions for the pair task."],
  nextStep: "Use pair talk once in every lesson this week.",
  sections: [{ code: "B", name: "Lesson Plan Fidelity", pct: 56 }, { code: "C", name: "High-Leverage Practices", pct: 54 }],
  practices: [{ id: "C1", name: "Quality Questioning", section: "C", score: 1, scaleMax: 2 }],
  lpSteps: null,
  reflection: [],
};

export const TRAINING_ITEMS: ItemsData = {
  courses: [{ name: "Course One", done: false, parts: [{ name: "Part A", doneAt: "2026-10-27" }, { name: "Part B", doneAt: null }] }],
};

export const SESSION_REPORT: SessionReportData = {
  kind: "dc", coachName: null, form: null, reviewed: true,
  teacher: { teacherExtId: EXT, name: NAMES[0] },
  date: "2026-10-26", grade: 3, subject: "Mathematics", overall: 67,
  whatWentWell: ["You explained halves and quarters correctly."],
  nextStep: "Give students two minutes to discuss in pairs.",
  sections: [{ code: "B", name: "Lesson Plan Fidelity", pct: 73 }, { code: "C", name: "High-Leverage Practices", pct: 65 }],
  practices: [
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
