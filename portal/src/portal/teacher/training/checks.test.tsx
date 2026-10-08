import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";

/**
 * bd-fmf24g.5 — the teacher v2 Training pages keep the kit's rules (teacher/ui/checks.test.tsx), with the
 * same checkers: start/end only, motion only under motion-safe:, no lying theme classes; every word from
 * copy.ts (≤4 words, never a sentence); every target 56px. And the registry: every page under the v2 base.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { TRAINING_V2_COPY } from "./copy";
import { LoadState, TrainingPageV2 } from "./TrainingFrame";
import routes from "./routes";
import { TRAINING_V2_BASE } from "./model";

const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe("training: style", () => {
  it("reads the pages' source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["TrainingHub.tsx", "TrainingLevelPage.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
});

describe("training: copy", () => {
  it("every word is a label: at most 4 words, never a sentence", () => {
    const bad = collectCopy(TRAINING_V2_COPY).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("no words written into a page (they come from copy.ts)", () => {
    const problems = files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe("training: every target is 56px or more", () => {
  it("the page's Back (link and button) and the retry", () => {
    const { container } = render(
      <MemoryRouter>
        <TrainingPageV2 crumb="C" title="T" backTo="/x"><LoadState loading={false} failed onRetry={() => {}} /></TrainingPageV2>
        <TrainingPageV2 crumb="C" title="T" backTo="/x" onBack={() => {}}><span /></TrainingPageV2>
      </MemoryRouter>,
    );
    expect(tapProblems(container)).toEqual([]);
  });
});

describe("training: routes", () => {
  it("registers the main page and every training screen under the v2 base", () => {
    const paths = routes.map((r) => r.path);
    expect(paths[0]).toBe(TRAINING_V2_BASE);
    expect(paths.every((p) => p.startsWith(TRAINING_V2_BASE))).toBe(true);
    for (const suffix of ["/certificates", "/grades", "/unit/:moduleId", "/unit/:moduleId/quiz", "/exam/:courseId",
      "/provider/:vendorKey/level/:levelId", "/provider/:vendorKey/level/:levelId/exam",
      "/provider/:vendorKey/level/:levelId/course/:browseCourseId"]) {
      expect(paths).toContain(`${TRAINING_V2_BASE}${suffix}`);
    }
  });
});
