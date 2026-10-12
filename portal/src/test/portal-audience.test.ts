import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// bd-2468 — the portal serves BOTH teachers and coaches (the leader/My-Patch
// side is a coach surface), so "NIETE Teacher Portal" is wrong on the shared
// chrome: the login screen, the browser title/social cards, and the 404. The
// audience-neutral name is "NIETE Portal".
//
// Scoped deliberately: role-specific copy INSIDE the app (a teacher's own
// dashboard, "Teachers" in the coach nav) is correct and must stay.

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const SHARED_CHROME = [
  "index.html",
  "src/portal/pages/PortalLogin.tsx",
  "src/portal/auth/copy.ts",
  "src/pages/NotFound.tsx",
];

describe("audience-neutral portal naming (bd-2468)", () => {
  it("no shared-chrome surface calls it the Teacher Portal", () => {
    for (const f of SHARED_CHROME) {
      expect({ file: f, teacherBranded: /Teacher Portal/i.test(read(f)) })
        .toEqual({ file: f, teacherBranded: false });
    }
  });

  it("the login screen and browser title say 'NIETE Portal'", () => {
    // bd-fmf24g.64: the login's words moved to auth/copy.ts (the mark's accessible name); the browser title is unchanged.
    expect(read("src/portal/auth/copy.ts")).toContain("NIETE Portal");
    expect(read("index.html")).toContain("<title>NIETE Portal</title>");
  });

  it("the login no longer claims an audience at all", () => {
    // bd-fmf24g.64 (operator decision): "For teachers and coaches — sign in to continue" is a sentence, so it is gone;
    // coaches and principals sign in here too, and neither the old teacher-only line nor a teacher-only title may return.
    const words = read("src/portal/auth/copy.ts");
    expect(words).not.toMatch(/access your teaching resources/i);
    expect(words).not.toMatch(/Teacher Portal/i);
    expect(words).not.toMatch(/sign in to continue/i);
  });

  it("keeps role-specific copy inside the app (not over-swept)", () => {
    // the coach's roster nav item is legitimately about teachers
    expect(read("src/portal/components/PortalNavigation.tsx")).toContain("Teachers");
  });
});
