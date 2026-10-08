import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";

/**
 * bd-fmf24g.7 — the teacher v2 Attendance pages keep the kit's rules (teacher/ui/checks.test.tsx), with the
 * same checkers: start/end only, motion only under motion-safe:, no lying theme classes; every word from
 * copy.ts (≤4 words, never a sentence); every target 56px. And the registry: every page under the v2 base.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { ATTENDANCE_V2_COPY } from "./copy";
import { LoadState, SearchBox } from "./ui";
import routes from "./routes";
import { ATTENDANCE_V2_BASE } from "./paths";

const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe("attendance: style", () => {
  it("reads the pages' source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["AttendanceHub.tsx", "MarkPage.tsx", "ViewPage.tsx", "DownloadPage.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
});

describe("attendance: copy", () => {
  it("every word is a label: at most 4 words, never a sentence", () => {
    const bad = collectCopy(ATTENDANCE_V2_COPY).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("no words written into a page (they come from copy.ts)", () => {
    const problems = files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe("attendance: every target is 56px or more", () => {
  it("the search box with its clear, and the retry", () => {
    const { container } = render(
      <MemoryRouter>
        <SearchBox value="ali" onChange={() => {}} label={ATTENDANCE_V2_COPY.searchStudent} />
        <LoadState loading={false} failed onRetry={() => {}} />
      </MemoryRouter>,
    );
    expect(tapProblems(container)).toEqual([]);
  });
});

describe("attendance: routes", () => {
  it("registers the selector and every attendance screen under the v2 base", () => {
    const paths = routes.map((r) => r.path);
    expect(paths[0]).toBe(ATTENDANCE_V2_BASE);
    expect(paths.every((p) => p.startsWith(ATTENDANCE_V2_BASE))).toBe(true);
    for (const suffix of ["/:listId/mark", "/:listId/view", "/:listId/download"]) {
      expect(paths).toContain(`${ATTENDANCE_V2_BASE}${suffix}`);
    }
  });
});
