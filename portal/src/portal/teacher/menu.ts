import { featureOf, type TeacherFeature } from "./paths";

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

