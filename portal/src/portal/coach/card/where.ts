import api from "../../services/api";
import type { TeachingLevel } from "../people/level";
import type { Period, PeriodKey } from "./types";

/**
 * Where to coach and Who to coach first (bd-17v39c.4.14): their shapes and their two reads, GET /api/portal/coach/...
 * (dashboard where-to-coach.service.js, behind the School card switch; 404 when it is off for her or the teacher or
 * school is not hers). Coach only, read only. Every number, every tip and every "why" is the server's (Rifat's DC
 * pattern engine); nothing here ranks or counts.
 */

export type SectionCode = "B" | "C" | "D" | "F";
export type Tip = { lookFor: string; tryThis: string };
export type Tips = { source: string; en: Tip; ur: Tip } | null;

/** Which of her focus-rule tests picked the focus (1 both scored it low · 2 low in k of n · 3 a skipped step · 4 lowest). */
export type Why =
  | { test: 1; reason: "both" }
  | { test: 2; reason: "low"; k: number; n: number; source: "dc" | "coach" }
  | { test: 3; reason: "step"; step: string }
  | { test: 4; reason: "lowest" };

export type Practice = {
  id: string; section: SectionCode; name: string | null;
  n: number; k: number; avg: number; scaleMax: number; latest: number; change: number | null;
  tips: Tips; focus?: boolean;
};

export type WhereSection = { code: SectionCode; dc: number | null; coach: number | null; agreeLow: boolean; differ: boolean; focusHere: boolean };
export type SkippedStep = { step: string; index: number; skipped: number; of: number; tips: Tips };
export type CheckinFeature = "dc" | "lp" | "training" | "papers";
export type CheckinContent = { questions: string[]; blockers: [string, string][] };
export type CheckinItem = {
  feature: CheckinFeature; state: "none" | "low" | "next"; count: number; median?: number; cut?: number;
  content: { en: CheckinContent; ur: CheckinContent } | null;
};

export type WhereToCoachData = {
  teacher: { teacherExtId: string; name: string; school: string | null; emis: string | null };
  period: Period;
  framework: "fico_v3" | "fico_v4" | null;
  scaleMax: number | null;
  sessions: { dc: number; coach: number };
  /** patterns: 2+ DC · early: 1 DC ("an early signal") · coach_only: coach observations only · empty: nothing */
  signal: "patterns" | "early" | "coach_only" | "empty";
  sections: WhereSection[];
  focus: (Practice & { why: Why; linkedStep: string | null }) | null;
  weakest: Practice[];
  strength: Practice | null;
  plan: { pct: number; measured: number; of: number; skipped: SkippedStep[] } | null;
  lastAdvice: { text: string; date: string; sessionId: string } | null;
  reports: { id: string; date: string; grade: string | null; subject: string | null; title: string | null; score: number | null; weakest: SectionCode | null }[];
  moreReports: number;
  checkin: { usage: Record<CheckinFeature, number>; items: CheckinItem[] };
};

export type CoachFirstGroup = "agree_low" | "low_most" | "no_dc" | "one_dc" | "none";
export type CoachFirstRow = {
  teacherExtId: string; name: string; isPrincipal?: boolean; group: CoachFirstGroup;
  focus: { id: string; name: string | null; section: SectionCode; why: Why } | null;
  k: number | null; n: number | null; sessions: { dc: number; coach: number }; lastDcDaysAgo: number | null;
};
export type CoachFirstData = {
  school: { emis: string; name: string };
  period: Period;
  level: TeachingLevel | null;
  teachers: number;
  groups: { key: CoachFirstGroup; rows: CoachFirstRow[] }[];
};

const coachDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const seg = encodeURIComponent;
const get = <T>(path: string, period: PeriodKey, level?: TeachingLevel | null): Promise<T> =>
  api.get(path, { params: { period, ...(level ? { level: level.toLowerCase() } : {}), today: coachDay() } }).then((r) => r.data as T);

export const where = {
  teacher: (ext: string, period: PeriodKey) => get<WhereToCoachData>(`/coach/teacher/${seg(ext)}/where`, period),
  school: (emis: string, period: PeriodKey, level?: TeachingLevel | null) => get<CoachFirstData>(`/coach/school/${seg(emis)}/first`, period, level),
};

/** The addresses. Both open on This month (Rifat's review, 5 Nov: pick 1B), with the chips to change it. */
export const whereTo = (ext: string) => `/portal/coach/teacher/${seg(ext)}/where?period=month`;
export const firstTo = (emis: string) => `/portal/coach/school/${seg(emis)}/first?period=month`;
