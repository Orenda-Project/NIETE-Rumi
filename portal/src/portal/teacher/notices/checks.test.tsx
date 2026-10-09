import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";
import { ReadyBanner } from "../ui/ReadyBanner";
import { ReadyTray } from "../ui/ReadyTray";
import { LeaveNote } from "../ui/LeaveNote";
import { NOTICES, NOTICES_COPY } from "./copy";

/**
 * bd-fmf24g.15 — the notices' design rules, checked with the new UI's own checkers (as the kit's are): start/end
 * only (Urdu mirrors), motion only under motion-safe:, no words written into a component, every target 56px,
 * and every word of the notices' own copy a label — but for the two sentences the design names, each with its
 * reason.
 */
const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe("notices: style and copy", () => {
  it("reads its own source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["NoticeHost.tsx", "tracker.ts", "copy.ts"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(`notices/${f.rel}`, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });

  it("no words written into a component (they come from copy.ts)", () => {
    const problems = files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(`notices/${f.rel}`, f.text));
    expect(problems).toEqual([]);
  });

  it("every word is a label, but the two sentences the operator's design names (COMPONENTS.md §12)", () => {
    const SENTENCES = ["leave", "listNote"];
    const bad = collectCopy(NOTICES_COPY).filter((c) => copyProblem(c.text) && !SENTENCES.includes(c.path)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
    expect(NOTICES.en.leave).toBe("You can leave. We'll tell you here.");
    expect(NOTICES.ur.leave).toBe("آپ یہاں سے جا سکتے ہیں۔ تیار ہونے پر ہم یہیں بتائیں گے۔");
  });
});

describe("notices: every target is 56px or more", () => {
  it("the strip's rows and More, the banner's Open, ✕ and Try again, in every shape", () => {
    const row = { id: "a", feature: "lessons" as const, what: "Lesson plan", gradeSubject: "Grade 7 · Science", title: "T", state: "making" as const, progress: 0.5, left: "~1 min left", to: "/a" };
    const b = { id: "b", feature: "assessment" as const, what: "Paper", title: "T", line: "Grade 4" };
    const { container } = render(
      <MemoryRouter>
        <ReadyTray items={[row, { ...row, id: "c", state: "failed" }, { ...row, id: "d" }]} onOpenList={() => {}} />
        <ReadyBanner items={[b]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />
        <ReadyBanner items={[b, { ...b, id: "e" }, { ...b, id: "f" }, { ...b, id: "g" }]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} onSeeAll={() => {}} />
        <ReadyBanner variant="failed" items={[b]} reason="x" onRetry={() => {}} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />
        <LeaveNote text="x" />
      </MemoryRouter>,
    );
    expect(tapProblems(container)).toEqual([]);
  });
});
