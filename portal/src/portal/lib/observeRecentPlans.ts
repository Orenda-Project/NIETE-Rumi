/**
 * bd-snkn32.41 — the observed teacher's recent plans are her downloads plus the plans she made herself
 * (Make my own). Check and send's tray lists both; the library picker picks by asset, so it gets downloads only.
 */
import type { ObserveRecentPlan, OwnRecentPlan, RecentLessonPlan } from "../services/api";

export const isOwnPlan = (p: ObserveRecentPlan): p is OwnRecentPlan => (p as OwnRecentPlan).own === true;

export const downloadsOnly = (r: { plans: ObserveRecentPlan[] }): { plans: RecentLessonPlan[] } =>
  ({ plans: ((r && r.plans) || []).filter((p): p is RecentLessonPlan => !isOwnPlan(p)) });
