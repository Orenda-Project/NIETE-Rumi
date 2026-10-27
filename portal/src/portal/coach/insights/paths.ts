import { COACH_INSIGHTS_BASE } from "../training/appReady";

/**
 * bd-sex15q.15 — every COACHIP coach address. Ids in a path are a W id or a moment uuid only; never a teacher code,
 * `code_id`, key or name (B1, B21). A school id travels as `?school=` on S5 only (a school is not a person).
 */
export const INSIGHTS_BASE = COACH_INSIGHTS_BASE;

export const insightsPaths = {
  thisWeek: INSIGHTS_BASE,
  w: (wId: string) => `${INSIGHTS_BASE}/w/${encodeURIComponent(wId)}`,
  where: (wId: string) => `${INSIGHTS_BASE}/w/${encodeURIComponent(wId)}/where`,
  move: (wId: string, schoolId?: string | null) =>
    `${INSIGHTS_BASE}/w/${encodeURIComponent(wId)}/move${schoolId ? `?school=${encodeURIComponent(schoolId)}` : ""}`,
  moment: (momentId: string) => `${INSIGHTS_BASE}/m/${encodeURIComponent(momentId)}`,
  schools: `${INSIGHTS_BASE}/schools`,
  listen: `${INSIGHTS_BASE}/listen`,
  stats: `${INSIGHTS_BASE}/stats`,
  results: `${INSIGHTS_BASE}/stats/results`,
  more: "/portal/coach/more",
} as const;

export type InsightsNavKey = "thisWeek" | "schools" | "listen" | "stats" | "more";

export const INSIGHTS_NAV: readonly { key: InsightsNavKey; to: string; copy: "nav.this_week" | "nav.schools" | "nav.listen" | "nav.stats" | "nav.more" }[] = [
  { key: "thisWeek", to: insightsPaths.thisWeek, copy: "nav.this_week" },
  { key: "schools", to: insightsPaths.schools, copy: "nav.schools" },
  { key: "listen", to: insightsPaths.listen, copy: "nav.listen" },
  { key: "stats", to: insightsPaths.stats, copy: "nav.stats" },
  { key: "more", to: insightsPaths.more, copy: "nav.more" },
];

/** Which item is current: a W, its where/move/moment pages belong to This week; Results to Stats; More's pages to More. */
export function currentInsightsItem(pathname: string): InsightsNavKey | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === insightsPaths.schools || p.startsWith(`${insightsPaths.schools}/`)) return "schools";
  if (p === insightsPaths.listen || p.startsWith(`${insightsPaths.listen}/`)) return "listen";
  if (p === insightsPaths.stats || p.startsWith(`${insightsPaths.stats}/`)) return "stats";
  if (p === INSIGHTS_BASE || p.startsWith(`${INSIGHTS_BASE}/`)) return "thisWeek";
  if (["/portal/coach/more", "/portal/coach/profile", "/portal/account", "/portal/coach/training", "/portal/teacher/lessons"]
    .some((x) => p === x || p.startsWith(`${x}/`))) return "more";
  return null;
}
