import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";
import { JOURNEY_COPY } from "./copy";
import { JourneyList } from "./JourneyList";

/**
 * My journey's design rules, with the new UI's own checkers (as the kit's): start/end only, motion only under
 * motion-safe:, no words written into a component, every word a label (but the updated lines: a time inside a
 * label), every target 56px.
 */
const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));
const NOW = Date.parse("2026-11-19T15:00:00+05:00");

describe("My journey: style and copy", () => {
  it("reads its own source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["JourneyPage.tsx", "JourneyList.tsx", "copy.ts"]));
  });
  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes, no raw colours", () => {
    expect(files().flatMap((f) => scanStyle(`journey/${f.rel}`, f.text))).toEqual([]);
  });
  it("no words written into a component", () => {
    expect(files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(`journey/${f.rel}`, f.text))).toEqual([]);
  });
  it("every word is a label", () => {
    const LONG = ["updatedToday", "updatedYesterday", "updatedLastNight"];
    expect(collectCopy(JOURNEY_COPY).filter((c) => copyProblem(c.text) && !LONG.includes(c.path))).toEqual([]);
  });
});

describe("My journey: every target is 56px or more", () => {
  it("rows and Show more", () => {
    const steps = [0, 8, 16].map((d) => ({ kind: "coached", at: new Date(NOW - d * 86400000).toISOString(), refId: `s${d}`, meta: { topic: "T" } }));
    const { container } = render(<MemoryRouter><JourneyList steps={steps} now={NOW} /></MemoryRouter>);
    expect(tapProblems(container)).toEqual([]);
  });
});
