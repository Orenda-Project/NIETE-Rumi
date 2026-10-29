import { LESSONS_HOME } from "../../teacher/lessons/paths";
import { RM_BASE } from "../../rm/paths";

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
export type CoachFeature = "training" | "lessons" | "home" | "schedule" | "observe" | "schools" | "analytics" | "insights";

type Id = number | string;

// "schools": the coach's school list and its pages (Schools & teachers, a school, a teacher, add / remove): "My schools"
// in the menu (operator, 27 Oct 2026). Listed after training, so the Training Library stays the landing page.
export const COACH_APP_READY: readonly CoachFeature[] = ["training", "lessons", "schools"];

/**
 * Is this feature showing in the coach app for every v2 coach? A page in a ready feature uses it to leave out a link
 * into one that is not (the guard would send that tap to the Training Library instead).
 */
export function coachFeatureReady(feature: CoachFeature): boolean {
  return COACH_APP_READY.includes(feature);
}

export const COACH_TRAINING_BASE = "/portal/coach/training";

/**
 * bd-sex15q.15 — COACHIP, the coach insight screens ("This week" and the pages under it). Never in COACH_APP_READY: a
 * coach gets it only with portal_coachip on (coachReadyFor below), and then it is first, so "This week" is home
 * (the lead's decision). Training and Lesson Plans stay reachable, from More.
 */
export const COACH_INSIGHTS_BASE = "/portal/coach/insights";

/**
 * The ready list for a v2 coach: COACHIP's pages first when her switch is on, else exactly COACH_APP_READY.
 *
 * The School card (`schoolCard`, /config features.schoolCard, a literal true only): the slim coach Home comes first, so it
 * is her landing page, with the School card pages (My schools, and the DC report under "home"), Training and Lesson
 * Plans. It wins over COACHIP: Schedule, Observe, Reports, Analytics and Insights all stay shut. Off, absent or unread:
 * exactly what it was.
 */
export function coachReadyFor(coachip: boolean | null | undefined, schoolCard?: boolean | null): readonly CoachFeature[] {
  if (schoolCard === true) return ["home", ...COACH_APP_READY, ...(COACH_APP_READY.includes("schools") ? [] : ["schools" as const])];
  return coachip === true ? ["insights", ...COACH_APP_READY] : COACH_APP_READY;
}

export const coachTrainingPaths = {
  home: COACH_TRAINING_BASE,
  provider: (vendorKey: string) => `${COACH_TRAINING_BASE}/${encodeURIComponent(vendorKey)}`,
  module: (id: Id) => `${COACH_TRAINING_BASE}/module/${encodeURIComponent(String(id))}`,
  previewModule: (id: Id) => `${COACH_TRAINING_BASE}/preview?module_id=${encodeURIComponent(String(id))}`,
  previewLevel: (id: Id) => `${COACH_TRAINING_BASE}/preview?level_id=${encodeURIComponent(String(id))}`,
  previewCourseExam: (id: Id) => `${COACH_TRAINING_BASE}/preview?course_id=${encodeURIComponent(String(id))}&kind=module_exam`,
};

/**
 * Where each feature lives: `exact` addresses match only themselves (Home's is a prefix of every coach page), `prefixes`
 * match themselves and every page under them. Home also holds the School card's DC report (/portal/coach/session/:id).
 */
const FEATURE_PATHS: Record<CoachFeature, { prefixes: readonly string[]; exact?: readonly string[] }> = {
  training: { prefixes: [COACH_TRAINING_BASE] },
  // The teacher's own Lesson Plans pages; TeacherGate decides which of them a leader reads (routes.tsx `leaders`).
  lessons: { prefixes: [LESSONS_HOME] },
  home: { exact: ["/portal/coach"], prefixes: ["/portal/coach/session"] },
  schedule: { prefixes: ["/portal/coach/scheduling", "/portal/coach/schedule", "/portal/coach/team", "/portal/coach/new-visit"] },
  observe: { prefixes: ["/portal/coach/observe", "/portal/coach/visit", "/portal/coach/observation", "/portal/coach/reports"] },
  schools: { prefixes: ["/portal/coach/people", "/portal/coach/school", "/portal/coach/schools", "/portal/coach/add-teacher", "/portal/coach/teacher"] },
  analytics: { prefixes: ["/portal/coach/analytics"] },
  insights: { prefixes: [COACH_INSIGHTS_BASE] },
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
  // bd-sex15q.17 — the RM pages gate themselves (GET /coachip/me → rm); an RM who is also a v2 coach must reach them.
  /^\/portal\/rm(\/|$)/,
  // bd-tbprit.6 — the disagreement card and its list; the page turns away anyone without coach_disagreement_card.
  /^\/portal\/coach\/disagreements(\/[^/]+)?$/,
];

const trimmed = (p: string) => p.replace(/\/+$/, "") || "/";

export function coachPathReady(pathname: string, ready: readonly CoachFeature[] = COACH_APP_READY): boolean {
  const p = trimmed(pathname);
  if (ALWAYS_OPEN.some((re) => re.test(p))) return true;
  return ready.some((f) => {
    const spec = FEATURE_PATHS[f];
    return (spec.exact ?? []).includes(p) || spec.prefixes.some((x) => p === x || p.startsWith(`${x}/`));
  });
}

/** Where a v2 coach is sent from a page that is not ready: the first ready feature's page. */
export function coachReadyHome(ready: readonly CoachFeature[] = COACH_APP_READY): string {
  const first = ready[0];
  return first === "training" || !first ? COACH_TRAINING_BASE : (FEATURE_PATHS[first].exact?.[0] ?? FEATURE_PATHS[first].prefixes[0]);
}

/**
 * fix-r5 s2 item 9 (qa-rm R1 FAIL 20261027T072541, idea 072624; SPEC v2.1 §11.6): where a v2 coach lands. An RM (a
 * literal `coachipRm === true` in /config) whose own COACHIP switch is not on lands on the RM home. A dual-role user
 * (both on) lands on the RM home too when the RM sector is not one they coach in (fix-r5 s5, red-3 challenge 161108:
 * `/coachip/me` rm.coachesHere a literal `false`), else keeps "This week"; with coachipRm off, absent or unreadable
 * this is exactly coachReadyHome (B8).
 */
export function coachLandingFor(
  ready: readonly CoachFeature[],
  coachip: boolean | null | undefined,
  coachipRm: boolean | null | undefined,
  rmCoachesHere?: boolean | null,
): string {
  if (coachipRm !== true) return coachReadyHome(ready);
  return coachip !== true || rmCoachesHere === false ? RM_BASE : coachReadyHome(ready);
}
