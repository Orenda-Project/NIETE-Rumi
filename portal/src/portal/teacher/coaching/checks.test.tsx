import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";

/**
 * bd-fmf24g.4 — the teacher v2 Digital Coaching pages keep the kit's rules (teacher/ui/checks.test.tsx), with
 * the same checkers: start/end only, motion only under motion-safe:, no lying theme classes; every word from
 * copy.ts (≤4 words, never a sentence — the Photos hint is the one line the operator asked for); 56px targets.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { COACHING_V2_COPY } from "./copy";
import { PhotoGrid, PlanPicker } from "./parts";

const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe("coaching: style", () => {
  it("reads the pages' source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["CoachingHome.tsx", "SendPage.tsx", "parts.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
});

describe("coaching: copy", () => {
  it("every word is a label: at most 4 words, never a sentence (the Photos hint excepted)", () => {
    const bad = collectCopy(COACHING_V2_COPY)
      .filter((c) => c.path !== "photosHint")
      .filter((c) => copyProblem(c.text))
      .map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("the Photos hint is one short line, no full stop", () => {
    expect(COACHING_V2_COPY.photosHint.split(" ").length).toBeLessThanOrEqual(6);
    expect(COACHING_V2_COPY.photosHint).not.toMatch(/[.?!]$/);
  });

  it("no words written into a page (they come from copy.ts)", () => {
    const problems = files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe("coaching: every target is 56px or more", () => {
  it("the plan trigger, a photo's remove, Add photo", () => {
    const photo = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const { container } = render(
      <>
        <PlanPicker plan={null} onOpen={() => {}} />
        <PhotoGrid photos={[photo]} onChange={() => {}} testId="p" />
      </>,
    );
    expect(tapProblems(container)).toEqual([]);
  });
});
