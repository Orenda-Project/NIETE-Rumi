import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssessVisitBar from "./AssessVisitBar";
import { COPY } from "../../lib/assess/copy";

// The visit clock counts against the limit it is given: 60:00 for a list of three (3 × 20 min), 45:00 otherwise.
// It is the time for the WHOLE visit, not one child: a label over the clock says so with the visit's number of
// children, and the digits are big enough to read at a glance.

const MIN = 60 * 1000;
const clock = () => screen.getByTestId("assess-visit-clock");
const label = () => screen.getByTestId("assess-visit-time-label");

describe("AssessVisitBar: the time limit", () => {
  it("a 60-minute limit reads 50:00 / 60:00 and is not red at 50:00", () => {
    render(<AssessVisitBar copy={COPY.en} done={2} total={3} kids={3} startedAt={Date.now() - 50 * MIN} limitMs={60 * MIN} sync={[]} />);
    expect(clock()).toHaveTextContent(/^50:0\d \/ 60:00$/);
    expect(clock().className).not.toContain("text-red-700");
  });

  it("a 60-minute limit is red at 61:00", () => {
    render(<AssessVisitBar copy={COPY.en} done={2} total={3} kids={3} startedAt={Date.now() - 61 * MIN} limitMs={60 * MIN} sync={[]} />);
    expect(clock()).toHaveTextContent(/\/ 60:00$/);
    expect(clock().className).toContain("text-red-700");
  });

  it("a 45-minute limit reads / 45:00 and is red at 50:00, as today", () => {
    render(<AssessVisitBar copy={COPY.en} done={2} total={5} kids={5} startedAt={Date.now() - 50 * MIN} limitMs={45 * MIN} sync={[]} />);
    expect(clock()).toHaveTextContent(/\/ 45:00$/);
    expect(clock().className).toContain("text-red-700");
  });

  it("Urdu: the 60-minute limit in Urdu digits", () => {
    render(<AssessVisitBar copy={COPY.ur} done={0} total={3} kids={3} startedAt={null} limitMs={60 * MIN} sync={[]} />);
    expect(clock()).toHaveTextContent("⁦۰۰:۰۰ / ۶۰:۰۰⁩");
  });
});

describe("AssessVisitBar: the clock says it is the whole visit's time", () => {
  it("English: a label over the clock names the whole visit and its three children", () => {
    render(<AssessVisitBar copy={COPY.en} done={0} total={3} kids={3} startedAt={null} limitMs={60 * MIN} sync={[]} />);
    expect(label()).toHaveTextContent("Time for the whole visit (3 children)");
  });

  it("the label follows the visit's size, not a fixed three", () => {
    render(<AssessVisitBar copy={COPY.en} done={0} total={5} kids={5} startedAt={null} limitMs={45 * MIN} sync={[]} />);
    expect(label()).toHaveTextContent("Time for the whole visit (5 children)");
  });

  it("one child reads 'child', not 'children'", () => {
    render(<AssessVisitBar copy={COPY.en} done={0} total={1} kids={1} startedAt={null} limitMs={20 * MIN} sync={[]} />);
    expect(label()).toHaveTextContent("Time for the whole visit (1 child)");
  });

  it("Urdu: the label in Urdu, the count in Urdu digits", () => {
    render(<AssessVisitBar copy={COPY.ur} done={0} total={3} kids={3} startedAt={null} limitMs={60 * MIN} sync={[]} />);
    expect(label()).toHaveTextContent("پورے دورے کا وقت (⁦۳⁩ بچوں کے لیے)");
  });

  it("the digits are big and fixed-width, so they read at a glance and do not jump each second", () => {
    render(<AssessVisitBar copy={COPY.en} done={0} total={3} kids={3} startedAt={null} limitMs={60 * MIN} sync={[]} />);
    expect(clock().className).toContain("text-3xl");
    expect(clock().className).toContain("tabular-nums");
    expect(clock().className).toContain("font-bold");
  });

  it("the clock is a timer to a screen reader, named by the label", () => {
    render(<AssessVisitBar copy={COPY.en} done={0} total={3} kids={3} startedAt={null} limitMs={60 * MIN} sync={[]} />);
    expect(screen.getByRole("timer", { name: "Time for the whole visit (3 children)" })).toBe(clock());
  });
});
