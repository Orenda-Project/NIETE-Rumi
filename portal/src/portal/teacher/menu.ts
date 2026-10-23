import { featureOf, featurePath, type TeacherFeature } from "./paths";

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
  const f = featureOf(pathname);
  return f ? MENU_ITEM_OF[f] : null;
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
 */
export const coachNavKeysFor = (ready: readonly string[]): readonly CoachNavKey[] =>
  (["home", "schedule", "observe", "schools", "training", "lessons"] as const).filter((k) => ready.includes(k)).concat("more" as never) as readonly CoachNavKey[];

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
  more: ["/portal/coach/more", "/portal/coach/profile", "/portal/account"],
};

export function currentCoachMenuItem(pathname: string): CoachNavKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === COACH_MENU_PATHS.home) return "home";
  for (const key of Object.keys(COACH_SECTIONS) as (keyof typeof COACH_SECTIONS)[]) {
    if (COACH_SECTIONS[key].some((p) => path === p || path.startsWith(`${p}/`))) return key;
  }
  return null;
}
