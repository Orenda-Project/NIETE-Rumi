import { featureOf, featurePath, type TeacherFeature } from "./paths";
import { JOURNEY_PATH } from "./journey/paths";

/** bd-fmf24g.1 — the five items of the teacher v2 menu. */
export type NavFeature = "home" | "lessons" | "coaching" | "training" | "more";

/** Which menu item a page belongs to. Pages reached from More keep More current. */
const MENU_ITEM_OF: Record<TeacherFeature, NavFeature | null> = {
  home: "home",
  observations: "home",
  lessons: "lessons",
  coaching: "coaching",
  training: "training",
  more: "more",
  profile: "more",
  assessment: "more",
  attendance: "more",
  classes: "more",
  analytics: "more",
};

export function currentMenuItem(pathname: string): NavFeature | null {
  // My journey is one tap from Home (bd-96f69c.9 design review #5): Home stays current there.
  const path = pathname.replace(/\/+$/, "");
  if (path === JOURNEY_PATH || path.startsWith(`${JOURNEY_PATH}/`)) return "home";
  const f = featureOf(pathname);
  return f ? MENU_ITEM_OF[f] : null;
}

/**
 * bd-33wxxi.9.1 — the principal app's menu (#78, a principal on portal_principal_app): Home · Observe · Lesson Plans ·
 * Training · More. Observe is the coach's word and glyph and opens Observations (her Observe page: her own lessons and
 * her teachers'), so it holds Observations, Digital Coaching and her own observe screens (/portal/teacher/principal/…).
 * Everything else is the teacher's menu rule (pages reached from More keep More current).
 */
export type PrincipalNavKey = "home" | "observe" | "lessons" | "training" | "more";

export const PRINCIPAL_NAV_KEYS: readonly PrincipalNavKey[] = ["home", "observe", "lessons", "training", "more"];

/** The teacher feature each principal item opens (its page through teacherPath). */
export const PRINCIPAL_NAV_FEATURE: Record<PrincipalNavKey, TeacherFeature> = {
  home: "home",
  observe: "observations",
  lessons: "lessons",
  training: "training",
  more: "more",
};

const PRINCIPAL_SCREENS = "/portal/teacher/principal";

export function currentPrincipalMenuItem(pathname: string): PrincipalNavKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === PRINCIPAL_SCREENS || path.startsWith(`${PRINCIPAL_SCREENS}/`)) return "observe";
  const f = featureOf(path);
  if (f === "observations" || f === "coaching") return "observe";
  const item = currentMenuItem(path);
  return item === "coaching" ? "observe" : item;
}


/**
 * bd-4404s7.1 — the COACH's menu (Coach_Home board): Home, Schedule, Observe, Schools, More. Same bar, same still
 * glyphs, the coach's items. Each item names the page it opens; a feature stays current on every page inside it.
 * More (`/portal/coach/more`) is the coach's overflow page: the screen that builds it registers the route.
 */
export type CoachNavKey = "home" | "schedule" | "observe" | "schools" | "training" | "lessons" | "more";

export const COACH_NAV_KEYS: readonly CoachNavKey[] = ["home", "schedule", "observe", "schools", "more"];

/**
 * bd-s42dye.2 — the coach app v2 while only some of it is ready (coach/training/appReady.ts): the menu is the ready
 * features' items, then More. Training Library is the first item, so it takes Home's place.
 * bd-4joiqz — Lesson Plans (the teacher Lesson Plans pages, read as a leader) comes after Training Library.
 * My schools comes after those two: the tabs a coach already knows keep their places, and the landing page stays first.
 */
export const coachNavKeysFor = (ready: readonly string[]): readonly CoachNavKey[] =>
  (["home", "training", "lessons", "schedule", "observe", "schools"] as const).filter((k) => ready.includes(k)).concat("more" as never) as readonly CoachNavKey[];

export const COACH_MENU_PATHS: Record<CoachNavKey, string> = {
  home: "/portal/coach",
  schedule: "/portal/coach/scheduling",
  observe: "/portal/coach/observe",
  schools: "/portal/coach/people",
  training: "/portal/coach/training",
  lessons: featurePath("lessons"),
  more: "/portal/coach/more",
};

const COACH_SECTIONS: Record<Exclude<CoachNavKey, "home">, readonly string[]> = {
  training: ["/portal/coach/training"],
  lessons: [featurePath("lessons")],
  schedule: ["/portal/coach/scheduling", "/portal/coach/schedule", "/portal/coach/team", "/portal/coach/new-visit"],
  observe: ["/portal/coach/observe", "/portal/coach/visit", "/portal/coach/observation", "/portal/coach/reports"],
  schools: ["/portal/coach/people", "/portal/coach/school", "/portal/coach/schools", "/portal/coach/add-teacher", "/portal/coach/teacher"],
  more: ["/portal/coach/more", "/portal/coach/profile", "/portal/coach/feedback", "/portal/account"],
};

/**
 * bd-jjcofw.10 (M5) — a visit's own page (/portal/coach/visit/<id>, not its steps) belongs to Schedule: she opened it from
 * her schedule. Opened from Observe's list it carries ?from=observe and stays Observe's. Its steps (record, attach,
 * check, sending) are Observe's.
 */
const VISIT_PAGE_RX = /^\/portal\/coach\/visit\/[^/]+$/;
export const FROM_OBSERVE = "observe";

/**
 * bd-o15qnr.26 — the visit flow v2 switch (portal_coach_flow_v2), rebuilt to #188's Concept 1 (the operator, 19 Nov):
 * ONE Observe entry holds every visit, booking and observation page (Schedule's and Observe's sections together), and
 * it opens the one Observe screen. The menu word stays "Observe" / مشاہدہ ("No need to make it Observations").
 */
export const COACH_FLOW_V2_PATHS: Partial<Record<CoachNavKey, string>> = {
  observe: "/portal/coach/observe",
};

/** Where a coach menu item goes, with the visit flow v2 switch on or off. */
export const coachMenuPath = (key: CoachNavKey, flowV2 = false): string =>
  (flowV2 ? COACH_FLOW_V2_PATHS[key] : undefined) ?? COACH_MENU_PATHS[key];

/** The School card menu with the full app AND the visit flow v2 on: Home · Observe · Lesson Plans · More. */
export const COACH_CARD_FLOW_NAV_KEYS: readonly CoachNavKey[] = ["home", "observe", "lessons", "more"];

const VISIT_RX = /^\/portal\/coach\/visit(\/|$)/;

export function currentCoachMenuItem(pathname: string, search = "", flowV2 = false): CoachNavKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === COACH_MENU_PATHS.home) return "home";
  if (flowV2 && VISIT_RX.test(path)) return "observe";
  if (flowV2 && [...COACH_SECTIONS.schedule, ...COACH_SECTIONS.observe].some((p) => path === p || path.startsWith(`${p}/`))) return "observe";
  if (VISIT_PAGE_RX.test(path)) return new URLSearchParams(search).get("from") === FROM_OBSERVE ? "observe" : "schedule";
  for (const key of Object.keys(COACH_SECTIONS) as (keyof typeof COACH_SECTIONS)[]) {
    if (COACH_SECTIONS[key].some((p) => path === p || path.startsWith(`${p}/`))) return key;
  }
  return null;
}

/**
 * The coach's menu with the School card on: Home · Lesson Plans · More. Home holds what opens from its tiles (My schools,
 * the School card pages, the Training Library) and the School card's DC report, so it stays current on all of them.
 */
export const COACH_CARD_NAV_KEYS: readonly CoachNavKey[] = ["home", "lessons", "more"];

export function currentCoachCardItem(pathname: string, search = "", flowV2 = false): CoachNavKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/portal/coach/session" || path.startsWith("/portal/coach/session/")) return "home";
  const key = currentCoachMenuItem(pathname, search, flowV2);
  return key === "schools" || key === "training" ? "home" : key;
}

/**
 * bd-jjcofw — the School card menu for a tester with the full coach app on (features.coachFullApp): Schedule and Observe
 * sit between Home and Lesson Plans, as in the coach's full menu. Everyone else keeps COACH_CARD_NAV_KEYS.
 */
export const COACH_CARD_FULL_NAV_KEYS: readonly CoachNavKey[] = ["home", "schedule", "observe", "lessons", "more"];
