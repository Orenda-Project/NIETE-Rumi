/**
 * The School card's API answers (GET /api/portal/coach/... behind the `portal_coach_school_card` switch), as the
 * dashboard serves them. Every number is a plain count or a stored score; the screens never make one up. A field the
 * server could not fill is null and the screen shows "—".
 */

export type PeriodKey = "today" | "week" | "month";

/** A day (This week) or a Monday-start week (This month). `future`: still ahead. `partial`: cut by the month or today. */
export type Bucket = { key: string; label: string; date: string; future: boolean; partial: boolean };

export type Period = {
  key: PeriodKey;
  from: string;
  to: string;
  today: string;
  schoolDaysSoFar: number;
  /** [] for Today. */
  buckets: Bucket[];
};

export type CardFeature = "lp" | "dc" | "training" | "papers";
/** Her own lists. Her DC observations and coach visits are not among them: they are the one Coaching list. */
export type ItemsFeature = "lp" | "papers" | "training";

export type FeatureCounts = Record<CardFeature, number>;

export type ActivityTile = {
  feature: CardFeature;
  total: number | null;
  /** Teachers with at least one in the period. */
  makers: number | null;
  /** "About N a day": null for Today. */
  perDay: number | null;
  /** One count per bucket. */
  series: (number | null)[];
};

export type CardTeacher = {
  teacherExtId: string;
  name: string;
  counts: FeatureCounts;
  total: number;
  /** Only for a teacher with total > 0. */
  contributionPct: number | null;
  star: boolean;
  lastVisitDaysAgo: number | null;
};

export type ScorePoint = { date: string; score: number | null };

export type CoachObsTeacher = {
  teacherExtId: string;
  name: string;
  count: number;
  points: ScorePoint[];
  latest: number | null;
  change: number | null;
};

export type SchoolCardData = {
  school: { emis: string; name: string; teachers: number; lastVisitDaysAgo: number | null };
  period: Period;
  tiles: ActivityTile[];
  teachers: CardTeacher[];
  coachObservations: { count: number; teachers: CoachObsTeacher[] };
};

export type GridRow = { teacherExtId: string; name: string; cells: (number | null)[]; total: number };

export type FeatureGridData = {
  feature: CardFeature;
  period: Period;
  rows: GridRow[];
  school: (number | null)[];
  total: number;
};

export type ScoreAvg = { avg: number | null; prevAvg: number | null };

/** Her DC observations and her coach visits in the period, each with its average score and the period before's. */
export type CoachingSummary = {
  dc: { count: number | null } & ScoreAvg;
  coach: { count: number | null } & ScoreAvg;
};

/** The AI score of each DC report and the Coach score of each reviewed visit, by date. */
export type ChartPoint = { kind: "dc" | "coach"; id: string; date: string; score: number | null };

export type TeacherCardData = {
  teacher: { teacherExtId: string; name: string; school: string | null; emis: string | null };
  period: Period;
  tiles: {
    lp: { count: number | null; series: (number | null)[] };
    papers: { count: number | null; series: (number | null)[] };
    training: { parts: number | null; courses: number | null; series: (number | null)[] };
    days: { withUse: number | null; schoolDays: number | null };
  };
  /** The Coaching card: the same summary and chart as the Coaching page. */
  summary: CoachingSummary;
  chart: ChartPoint[];
};

export type LpItem = { id: string; date: string; grade: string | number | null; subject: string | null; title: string | null };
export type PaperItem = { id: string; date: string; grade: string | number | null; subject: string | null; questions: number | null; marks: number | null };
export type TrainingCourse = { name: string; parts: { name: string; doneAt: string | null }[]; done: boolean };

export type ItemsData = {
  period?: Period;
  items?: (LpItem | PaperItem)[];
  courses?: TrainingCourse[];
};

export type SectionScores = { B: number | null; C: number | null; D: number | null; F: number | null };

/**
 * One row of the Coaching list: a DC report (opens its report) or a coach visit (information only).
 * `title`: the report's own lesson label, or null (the page writes "<Subject> lesson"). `quote`: the step she took away
 * (a DC report: the next step as she received it; a visit: the step agreed). `form`: "observe2" for a visit on the field
 * form (counted, never scored with the others).
 */
export type CoachingItem = {
  kind: "dc" | "coach";
  id: string;
  date: string;
  grade: string | number | null;
  subject: string | null;
  title: string | null;
  score: number | null;
  quote: string | null;
  sections: SectionScores;
  coachName: string | null;
  form?: "v3" | "observe2" | null;
};

export type CoachingData = {
  teacher: TeacherCardData["teacher"];
  period: Period;
  summary: CoachingSummary;
  chart: ChartPoint[];
  items: CoachingItem[];
};

export type SessionReportData = {
  teacher: { teacherExtId: string; name: string };
  date: string;
  grade: string | number | null;
  subject: string | null;
  overall: number | null;
  whatWentWell: string[];
  nextStep: string | null;
  sections: { code: string; name: string; pct: number | null }[];
  practices: { id: string; name: string; section: string; score: number | null; scaleMax: number }[];
  /** One entry per plan move: `step` is its phase's name, `verdict` the fidelity check's (executed, partial, not_done …). */
  lpSteps: { step: string | null; verdict: string; text?: string | null; mustHappen?: boolean }[] | null;
  reflection: { question: string; answer: string }[];
};
