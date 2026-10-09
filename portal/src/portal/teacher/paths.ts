/**
 * bd-fmf24g.1 — where each teacher v2 feature lives, and where today's page for
 * it lives. Kept apart from the registry (routes.tsx) so a feature's own
 * routes.tsx can import these without an import cycle.
 */

export const TEACHER_BASE = "/portal/teacher";

export type TeacherFeature =
  | "home" | "lessons" | "coaching" | "observations" | "training" | "assessment"
  | "attendance" | "classes" | "analytics" | "more" | "profile";

export const TEACHER_FEATURES: readonly TeacherFeature[] = [
  "home", "lessons", "coaching", "observations", "training", "assessment",
  "attendance", "classes", "analytics", "more", "profile",
];

/** Each feature's v2 main page. Inner pages live under it (e.g. /portal/teacher/lessons/…). */
const FEATURE_PATHS: Record<TeacherFeature, string> = {
  home: TEACHER_BASE,
  lessons: `${TEACHER_BASE}/lessons`,
  coaching: `${TEACHER_BASE}/coaching`,
  observations: `${TEACHER_BASE}/observations`,
  training: `${TEACHER_BASE}/training`,
  assessment: `${TEACHER_BASE}/assessment`,
  attendance: `${TEACHER_BASE}/attendance`,
  classes: `${TEACHER_BASE}/classes`,
  analytics: `${TEACHER_BASE}/analytics`,
  more: `${TEACHER_BASE}/more`,
  profile: `${TEACHER_BASE}/profile`,
};

/** Today's page for each feature — where a link goes until the feature's v2 page is registered. */
const LEGACY_PATHS: Record<TeacherFeature, string> = {
  home: "/portal/dashboard",
  lessons: "/portal/curriculum",
  coaching: "/portal/coaching",
  // Coach visits show in today's coaching list (a "Coach visit" chip).
  observations: "/portal/coaching",
  training: "/portal/training",
  assessment: "/portal/assessment",
  attendance: "/portal/attendance",
  classes: "/portal/classes",
  analytics: "/portal/coaching/analytics",
  // No page called "More" exists today; My account is its nearest neighbour.
  more: "/portal/account",
  profile: "/portal/account",
};

export function featurePath(feature: TeacherFeature): string {
  return FEATURE_PATHS[feature];
}

export function legacyPath(feature: TeacherFeature): string {
  return LEGACY_PATHS[feature];
}

/**
 * The v2 main page when it is registered, today's page otherwise. Only the
 * feature's own main path counts — an inner page alone is not a place to land.
 */
export function resolveTeacherPath(feature: TeacherFeature, registeredPaths: readonly string[]): string {
  const v2 = FEATURE_PATHS[feature];
  return registeredPaths.includes(v2) ? v2 : LEGACY_PATHS[feature];
}

/** Which feature a pathname belongs to (for the menu's current item); null outside v2 and today's pages. */
export function featureOf(pathname: string): TeacherFeature | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  // Most specific first: everything sits under TEACHER_BASE, which is Home.
  const ordered = [...TEACHER_FEATURES].sort((a, b) => FEATURE_PATHS[b].length - FEATURE_PATHS[a].length);
  for (const f of ordered) {
    const base = FEATURE_PATHS[f];
    if (f === "home" ? path === base : path === base || path.startsWith(`${base}/`)) return f;
  }
  // Today's pages, most specific first (/portal/coaching/analytics before /portal/coaching);
  // on a tie the earlier feature wins (coaching before observations).
  const legacyOrdered = [...TEACHER_FEATURES].sort((a, b) => LEGACY_PATHS[b].length - LEGACY_PATHS[a].length);
  for (const f of legacyOrdered) {
    const legacy = LEGACY_PATHS[f];
    if (path === legacy || path.startsWith(`${legacy}/`)) return f;
  }
  return null;
}
