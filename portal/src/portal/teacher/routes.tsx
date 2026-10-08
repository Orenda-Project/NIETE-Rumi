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
 *   import LessonsHome from "./LessonsHome";
 *   const routes: TeacherRoute[] = [
 *     { path: featurePath("lessons"), element: <LessonsHome /> },
 *     { path: `${featurePath("lessons")}/:grade/:subject`, element: <Chapters /> },
 *   ];
 *   export default routes;
 *
 * It is found at build time (import.meta.glob below). App.tsx renders every
 * registered route inside TeacherGate, so each page is flag-gated without asking.
 * Once a feature's main path is registered, every link to that feature (the bottom
 * menu, Home's tiles, More) goes to it; until then they go to today's page.
 */
export type TeacherRoute = { path: string; element: ReactElement };

const modules = import.meta.glob<{ default?: TeacherRoute[] }>("./*/routes.tsx", { eager: true });

/** Every registered teacher v2 route, in a stable order (by folder). */
export const TEACHER_ROUTES: TeacherRoute[] = Object.keys(modules)
  .sort()
  .flatMap((key) => modules[key].default ?? []);

/** Where a link to this feature goes right now: its v2 page if registered, today's page otherwise. */
export function teacherPath(feature: TeacherFeature): string {
  return resolveTeacherPath(feature, TEACHER_ROUTES.map((r) => r.path));
}
