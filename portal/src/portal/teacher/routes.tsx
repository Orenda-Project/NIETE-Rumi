import type { ReactElement } from "react";
import { resolveTeacherPath, type TeacherFeature } from "./paths";

export {
  TEACHER_BASE, TEACHER_FEATURES, featurePath, legacyPath, resolveTeacherPath, featureOf,
} from "./paths";
export type { TeacherFeature } from "./paths";

/**
 * bd-fmf24g.1 — the teacher v2 routes file.
 *
 * HOW A FEATURE REGISTERS ITS PAGES — one file, nothing shared to edit:
 * create `portal/src/portal/teacher/<your-folder>/routes.tsx` that default-exports
 * a TeacherRoute[], with every path under /portal/teacher (use featurePath() from
 * "../paths" for the main page):
 *
 *   import { featurePath } from "../paths";
 *   import { lazyPage as page } from "@/lib/lazyPage";
 *   const LessonsHome = page(() => import("./LessonsHome"));
 *   const routes: TeacherRoute[] = [
 *     { path: featurePath("lessons"), element: <LessonsHome /> },
 *     { path: `${featurePath("lessons")}/:grade/:subject`, element: <Chapters /> },
 *   ];
 *   export default routes;
 *
 * Each page through lazyPage, never a static import (bd-sex15q.34): this list is in the app's first chunk, so a
 * static import puts that page in front of every first open — a coach's too.
 * It is found at build time (import.meta.glob below). App.tsx renders every
 * registered route inside TeacherGate, so each page is flag-gated without asking.
 * Once a feature's main path is registered, every link to that feature (the bottom
 * menu, Home's tiles, More) goes to it; until then they go to today's page.
 */
export type TeacherRoute = {
  path: string;
  element: ReactElement;
  /**
   * bd-4joiqz — the leader family (coach, principal, AEO, supervisor, school leader) may READ this page too, whatever
   * their teacher-app flag: TeacherGate lets them through on it (and only on it). For the Lesson Plans pages a leader
   * reads, never a page of the teacher's own (her history, her coaching, her Home).
   */
  leaders?: boolean;
};

const modules = import.meta.glob<{ default?: TeacherRoute[] }>("./*/routes.tsx", { eager: true });

/** Every registered teacher v2 route, in a stable order (by folder). */
export const TEACHER_ROUTES: TeacherRoute[] = Object.keys(modules)
  .sort()
  .flatMap((key) => modules[key].default ?? []);

/** Where a link to this feature goes right now: its v2 page if registered, today's page otherwise. */
export function teacherPath(feature: TeacherFeature): string {
  return resolveTeacherPath(feature, TEACHER_ROUTES.map((r) => r.path));
}
