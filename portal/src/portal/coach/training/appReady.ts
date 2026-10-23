import { LESSONS_HOME } from "../../teacher/lessons/paths";

/**
 * bd-s42dye.2 — what the coach app v2 shows while only some of it is ready.
 *
 * A coach on v2 (portal_coach_v2 + role coach) gets the features named here and nothing else: their menu items,
 * their pages. Every other portal page she reaches (a bookmark, an old link, /portal/dashboard, /portal/leader/*,
 * the old /portal/training*) goes to the first ready feature's page. Enabling Observe later is one line:
 * add "observe" to COACH_APP_READY.
 *
 * bd-4joiqz — "lessons": the teacher Lesson Plans pages (/portal/teacher/lessons/*), read as a leader ("why can't a
 * coach see LPs in their IAB?", operator, 22 Oct 2026). Training stays first, so it stays her landing page.
 */
export type CoachFeature = "training" | "lessons" | "home" | "schedule" | "observe" | "schools" | "analytics";

type Id = number | string;

export const COACH_APP_READY: readonly CoachFeature[] = ["training", "lessons"];

export const COACH_TRAINING_BASE = "/portal/coach/training";

export const coachTrainingPaths = {
  home: COACH_TRAINING_BASE,
  provider: (vendorKey: string) => `${COACH_TRAINING_BASE}/${encodeURIComponent(vendorKey)}`,
  module: (id: Id) => `${COACH_TRAINING_BASE}/module/${encodeURIComponent(String(id))}`,
  previewModule: (id: Id) => `${COACH_TRAINING_BASE}/preview?module_id=${encodeURIComponent(String(id))}`,
  previewLevel: (id: Id) => `${COACH_TRAINING_BASE}/preview?level_id=${encodeURIComponent(String(id))}`,
  previewCourseExam: (id: Id) => `${COACH_TRAINING_BASE}/preview?course_id=${encodeURIComponent(String(id))}&kind=module_exam`,
};

/** Where each feature lives. `exact` = that address only (Home's is a prefix of every coach page). */
const FEATURE_PATHS: Record<CoachFeature, { prefixes: readonly string[]; exact?: boolean }> = {
  training: { prefixes: [COACH_TRAINING_BASE] },
  // The teacher's own Lesson Plans pages; TeacherGate decides which of them a leader reads (routes.tsx `leaders`).
  lessons: { prefixes: [LESSONS_HOME] },
  home: { prefixes: ["/portal/coach"], exact: true },
  schedule: { prefixes: ["/portal/coach/scheduling", "/portal/coach/schedule", "/portal/coach/team", "/portal/coach/new-visit"] },
  observe: { prefixes: ["/portal/coach/observe", "/portal/coach/visit", "/portal/coach/observation", "/portal/coach/reports"] },
  schools: { prefixes: ["/portal/coach/people", "/portal/coach/school", "/portal/coach/schools", "/portal/coach/add-teacher", "/portal/coach/teacher"] },
  analytics: { prefixes: ["/portal/coach/analytics"] },
};

/** Always reachable: her account (More, profile, My account) and the signed-out pages. */
const ALWAYS_OPEN: readonly RegExp[] = [
  /^\/portal\/coach\/more$/,
  /^\/portal\/coach\/profile$/,
  /^\/portal\/account$/,
  /^\/portal\/login$/,
  /^\/portal\/setup\//,
  /^\/portal\/reset-password(\/|$)/,
  /^\/portal\/privacy$/,
  /^\/portal\/delete-account$/,
  /^\/portal\/fln(\/|$)/,
  // bd-tbprit.6 — the disagreement card and its list; the page turns away anyone without coach_disagreement_card.
  /^\/portal\/coach\/disagreements(\/[^/]+)?$/,
];

const trimmed = (p: string) => p.replace(/\/+$/, "") || "/";

export function coachPathReady(pathname: string, ready: readonly CoachFeature[] = COACH_APP_READY): boolean {
  const p = trimmed(pathname);
  if (ALWAYS_OPEN.some((re) => re.test(p))) return true;
  return ready.some((f) => {
    const spec = FEATURE_PATHS[f];
    return spec.exact ? spec.prefixes.includes(p) : spec.prefixes.some((x) => p === x || p.startsWith(`${x}/`));
  });
}

/** Where a v2 coach is sent from a page that is not ready: the first ready feature's page. */
export function coachReadyHome(ready: readonly CoachFeature[] = COACH_APP_READY): string {
  const first = ready[0];
  return first === "training" || !first ? COACH_TRAINING_BASE : FEATURE_PATHS[first].prefixes[0];
}
