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
  /** bd-ewbzns.1 — PRIMARY / MIDDLE / HIGH, canonical order; [] when none is recorded. */
  levels?: string[];
  isPrincipal?: boolean;
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

/** A scored observation kind: a DC report (AI score) or a coach observation (Coach score, reviewed FICO-form visits only). */
export type ScoreKind = "dc" | "coach";

/** The school's scores of one kind for the period: count, average (and the period before's), by how many teachers,
 *  each scored report oldest first, and the average per bucket (null where none). */
export type SchoolScores = {
  count: number;
  avg: number | null;
  prevAvg: number | null;
  makers: number;
  points: { id: string; date: string; score: number; teacherExtId: string | null }[];
  series: (number | null)[];
};

export type SchoolCardData = {
  /** `teachers` is the level's when a level is asked for; `roster` (bd-ewbzns.1) is always the whole school's. */
  school: { emis: string; name: string; teachers: number; roster?: number; lastVisitDaysAgo: number | null };
  period: Period;
  tiles: ActivityTile[];
  teachers: CardTeacher[];
  coachObservations: { count: number; teachers: CoachObsTeacher[] };
  scores?: Record<ScoreKind, SchoolScores>;
  /** bd-ewbzns.1 — the level this card is for (null: the whole school), and the whole roster's count at each level. */
  level?: string | null;
  levels?: Partial<Record<"PRIMARY" | "MIDDLE" | "HIGH", number>>;
};

/** GET /coach/school/:emis/scores/:kind — per teacher, sorted by count then name; teachers with none last. */
export type SchoolScoresData = {
  kind: ScoreKind;
  period: Period;
  rows: { teacherExtId: string; name: string; count: number; avg: number | null; points: { id: string; date: string; score: number }[] }[];
  school: { emis: string; name: string; teachers: number; count: number; avg: number | null; makers: number };
};

/** One practice averaged across her scored reports: on the framework's scale (`scaleMax`) and as a %; `n` reports. */
export type PracticeAverage = { id: string; name: string; avg: number; pct: number; scaleMax: number; n: number };

/** Lesson Plan Fidelity across her reports: the mean share of plan steps followed (0-100), and for each of the five
 *  lesson steps any report judged (1 Opening, 2 Explanation, 3 We Do, 4 You Do, 5 Check) how its plan steps went. */
export type PlanAcross = { pct: number; steps: { step: number; done: number; partly: number; skipped: number }[] };

/** GET /coach/teacher/:ext/scores/:kind — her DC reports or her coach observations on their own. */
export type TeacherScoresData = {
  /** bd-ewbzns.2 — `isPrincipal` and `levels` (PRIMARY / MIDDLE / HIGH; [] when none recorded): what Edit teacher sets. */
  teacher: { teacherExtId: string; name: string; school: string | null; emis: string | null; isPrincipal?: boolean; levels?: string[] };
  period: Period;
  kind: ScoreKind;
  count: number;
  avg: number | null;
  prevAvg: number | null;
  series: { id: string; date: string; score: number }[];
  /** B C D F in order. `avg`: the mean of its practices' averages, null = Not scored. `scoredIn`: how many of her scored
   *  reports scored the section. B (Lesson Plan Fidelity) has no practices: it is `plan`, the plan steps the grader
   *  judged (bd-dgfkgs.3), null = no report measured its plan. */
  sections: { code: string; name: string; avg: number | null; scoredIn: number; indicators: PracticeAverage[]; plan?: PlanAcross | null }[];
  /** Newest first. `title`: the report's topic or real lesson label, else null. `score` null: not reviewed or field form. */
  reports: { id: string; date: string; grade: string | number | null; subject: string | null; title: string | null; score: number | null; form: "v3" | "observe2" | null; coachName: string | null }[];
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
  /** bd-ewbzns.2 — `isPrincipal` and `levels` (PRIMARY / MIDDLE / HIGH; [] when none recorded): what Edit teacher sets. */
  teacher: { teacherExtId: string; name: string; school: string | null; emis: string | null; isPrincipal?: boolean; levels?: string[] };
  period: Period;
  tiles: {
    lp: { count: number | null; series: (number | null)[] };
    papers: { count: number | null; series: (number | null)[] };
    training: { parts: number | null; courses: number | null; series: (number | null)[] };
    /** `used`: the school days (YYYY-MM-DD) she used NIETE, one dot each. */
    /** `uses`: each used day with the instruments she used that day; `perFeature`: how many days each was used on
     *  (bd-dgfkgs.4). */
    days: { withUse: number | null; schoolDays: number | null; used?: string[]; uses?: { day: string; features: CardFeature[] }[]; perFeature?: FeatureCounts };
  };
  /** Her Digital Coaching and Coach observations tiles: count, average and the period before's. */
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

export type SessionReportData = {
  /** "coach": a coach observation (its scores show once `reviewed`; `nextStep` is the step agreed). */
  kind?: ScoreKind;
  coachName?: string | null;
  form?: "v3" | "observe2" | null;
  reviewed?: boolean;
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
