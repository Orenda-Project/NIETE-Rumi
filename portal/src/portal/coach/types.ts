/** bd-o15qnr — what /api/portal/coach/* answers (dashboard/services/coach-v2.service.js). */

export type CoachVisit = {
  id: string;
  teacherName: string | null;
  schoolName: string | null;
  schoolExtId?: string | null;
  teacherExtId?: string | null;
  scheduledFor: string | null;
  scheduledSlot: string | null;
  status: string;
  sessionId?: string | null;
  overdue?: boolean;
  current?: boolean;
};

export type CoachTeacher = {
  teacherExtId: string | null;
  name: string;
  phone: string | null;
  onRumi?: boolean;
  rumiUserId?: string | null;
  schoolName: string | null;
  emis: string | null;
  schoolExtId: string | null;
  hitl: number;
  dc: number;
  avgHitl: number | null;
  lastVisitAt?: string | null;
  daysSinceVisit: number | null;
  /** bd-o15qnr.11 — shown on Edit teacher */
  isPrincipal?: boolean;
  /** bd-o15qnr.13 — her teaching levels (PRIMARY / MIDDLE / HIGH), for Edit teacher */
  levels?: string[];
  lastVisitScore?: number | null;
  lastTrainingAt?: string | null;
  daysSinceTraining: number | null;
  trainingModules?: number;
  /** bd-o15qnr.20 — ready assessment papers (the patch's exams_generated) */
  examsGenerated?: number;
  /** bd-o15qnr.20 — distinct lesson plans she used (lp-activity); null when not on Rumi. Teacher + Visit only. */
  lpOpened?: number | null;
};

export type CoachSchool = {
  schoolExtId: string;
  emis: string | null;
  name: string | null;
  teachers: number;
  visits: number;
  daysSinceVisit: number | null;
  avgHitl: number | null;
};

export type CoachHomeData = {
  today: CoachVisit[];
  /** bd-o15qnr.8 — her next upcoming visit on or after today, whatever its date. */
  next?: CoachVisit | null;
  counts: { week: number; overdue: number; waiting: number; inProgress: number; teachers: number; schools: number };
};

export type CoachScheduleData = { from: string; to: string; visits: CoachVisit[]; overdue: CoachVisit[] };

export type TeamVisit = {
  id: string;
  coachId: string;
  coachName: string | null;
  mine: boolean;
  teacherName: string | null;
  schoolName: string | null;
  status: string;
  done: boolean;
};

export type TeamData = {
  date: string;
  totals: { today: number; week: number; month: number };
  days: { date: string; count: number }[];
  groups: { slot: string | null; visits: TeamVisit[] }[];
  coaches: { id: string; name: string | null; me: boolean }[];
};

/** bd-15y1pc: `report` — her debrief is done, the report has not reached the teacher yet. */
export type ReportStep = "draft" | "talk" | "analysing" | "report" | "sent";

export type CoachReport = {
  id: string;
  createdAt: string | null;
  teacherName: string | null;
  teacherPhone: string | null;
  teacherExtId: string | null;
  schoolName: string | null;
  schoolExtId: string | null;
  status: string;
  step: ReportStep;
  score: number | null;
  portal: boolean;
};

export type ReportsData = {
  waiting: CoachReport[];
  inProgress: CoachReport[];
  all: { total: number; page: number; pageSize: number; items: CoachReport[] };
};

export type PeopleData = { teachers: CoachTeacher[]; schools: CoachSchool[] };
export type SchoolData = { school: CoachSchool; teachers: CoachTeacher[] };
export type TeacherData = {
  teacher: CoachTeacher;
  /** bd-o15qnr.10 — `open`: 'observe' = her own portal observation's page, 'report' = the v2 report, null = nothing to open. */
  history: { id: string; date: string | null; kind: "HITL" | "DC"; score: number | null; step?: string | null; open?: "observe" | "report" | null }[];
  nextVisit: CoachVisit | null;
};
/** bd-o15qnr.9 — her latest HITL visit, for the Visit page's Last visit row. */
export type LastVisit = {
  id?: string | null;
  date: string | null;
  score: number | null;
  step?: ReportStep;
  byMe?: boolean;
  observerName?: string | null;
  /** Started in the portal, so it opens in the portal's observation view. */
  portal?: boolean;
};
export type VisitData = { visit: CoachVisit; teacher: CoachTeacher | null; lastVisit: LastVisit | null };

/** bd-o15qnr.10 — one sent HITL report, read-only (GET /coach/observation/:id). */
export type ObservationReport = {
  id: string;
  date: string | null;
  /** bd-o15qnr.19 — where it stands, from the session row (draft · talk · analysing · sent). */
  step?: ReportStep;
  /** Her own observation started in the portal: the portal can take it through each step. */
  portal?: boolean;
  mine?: boolean;
  /** The Digital Coach's score, before her check too. */
  dcScore?: number | null;
  audioUrl?: string | null;
  score: number | null;
  summary: string | null;
  teacher: { name: string; teacherExtId: string | null; schoolName: string | null };
  observer: { self: boolean; name: string | null };
  sentAt: string | null;
  caption: string | null;
  imageUrl: string | null;
};
