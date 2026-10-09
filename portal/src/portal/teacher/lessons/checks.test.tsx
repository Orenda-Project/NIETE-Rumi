import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans pages keep the kit's rules (teacher/ui/checks.test.tsx),
 * with the same checkers: start/end only, motion only under motion-safe:, no lying theme classes;
 * every word from copy.ts (≤4 words, never a sentence); every target 56px.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({ default: () => <div /> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() } }));

import { LESSONS_V2_COPY } from "./copy";
import { LoadState } from "./LoadState";
import { ViewerPage } from "./ViewerPage";

const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe("lessons: style", () => {
  it("reads the pages' source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["ChaptersPage.tsx", "ViewerPage.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
});

describe("lessons: copy", () => {
  it("every word is a label: at most 4 words, never a sentence", () => {
    // pleaseHold is the operator's own sentence for the waiting page (ontology: Open item 9).
    const bad = collectCopy(LESSONS_V2_COPY).filter((c) => c.path !== "pleaseHold" && copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("no words written into a page (they come from copy.ts)", () => {
    const problems = files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe("lessons: every target is 56px or more", () => {
  it("the frame's Back (TeacherPage), the retry, the viewer's Start DC / Answer key / Open in another app", () => {
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: "/portal/teacher/lessons/plan", state: {
        lessonPlan: { source: { lane: "k5", lessonId: "a", assetKind: "lesson" }, title: "A" },
        dc: { grade: 4, subjectKey: "maths", plan: "k5:a", lang: null },
      } }]}>
        <LoadState status="error" empty onRetry={() => {}} />
        <ViewerPage />
      </MemoryRouter>,
    );
    expect(tapProblems(container)).toEqual([]);
  });
});
