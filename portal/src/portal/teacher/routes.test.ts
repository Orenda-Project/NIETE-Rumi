import { describe, it, expect } from "vitest";
import {
  TEACHER_BASE, TEACHER_FEATURES, featurePath, legacyPath, resolveTeacherPath, TEACHER_ROUTES, teacherPath,
} from "./routes";

/**
 * bd-fmf24g.1 — the teacher routes file. Each feature agent registers its pages by
 * adding ONE file, `portal/src/portal/teacher/<feature>/routes.tsx`, that default-
 * exports its routes; nothing shared is edited. A link to a feature goes to its v2
 * page once that page is registered, and to today's page until then.
 */
describe("teacher routes", () => {
  it("every v2 page lives under /portal/teacher", () => {
    expect(TEACHER_BASE).toBe("/portal/teacher");
    for (const f of TEACHER_FEATURES) expect(featurePath(f).startsWith(TEACHER_BASE)).toBe(true);
    for (const r of TEACHER_ROUTES) expect(r.path.startsWith(TEACHER_BASE)).toBe(true);
  });

  it("no two registered routes share a path", () => {
    const paths = TEACHER_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("a feature with no v2 page yet links to today's page", () => {
    expect(resolveTeacherPath("lessons", [])).toBe(legacyPath("lessons"));
    expect(legacyPath("lessons")).toBe("/portal/curriculum");
    expect(legacyPath("coaching")).toBe("/portal/coaching");
    expect(legacyPath("training")).toBe("/portal/training");
    expect(legacyPath("classes")).toBe("/portal/classes");
    expect(legacyPath("home")).toBe("/portal/dashboard");
  });

  it("once its page is registered, the link goes to the v2 page", () => {
    expect(resolveTeacherPath("lessons", ["/portal/teacher/lessons"])).toBe("/portal/teacher/lessons");
    expect(resolveTeacherPath("home", ["/portal/teacher"])).toBe("/portal/teacher");
  });

  it("an inner page alone does not count as the feature's page", () => {
    expect(resolveTeacherPath("lessons", ["/portal/teacher/lessons/:grade"])).toBe(legacyPath("lessons"));
  });

  it("teacherPath reads the real registry", () => {
    const registered = TEACHER_ROUTES.map((r) => r.path);
    for (const f of TEACHER_FEATURES) expect(teacherPath(f)).toBe(resolveTeacherPath(f, registered));
  });
});
