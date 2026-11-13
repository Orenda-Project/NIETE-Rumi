import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssessVisitBar from "./AssessVisitBar";
import { COPY } from "../../lib/assess/copy";

// The visit clock counts against the limit it is given: 60:00 for a list of three (3 × 20 min), 45:00 otherwise.

const MIN = 60 * 1000;
const time = () => screen.getByText((_, el) => el?.tagName === "SPAN" && /^(Time|وقت)/.test(el.textContent ?? ""));

describe("AssessVisitBar: the time limit", () => {
  it("a 60-minute limit reads / 60:00 and is not red at 50:00", () => {
    render(<AssessVisitBar copy={COPY.en} done={2} total={3} startedAt={Date.now() - 50 * MIN} limitMs={60 * MIN} sync={[]} />);
    expect(time()).toHaveTextContent(/^Time 50:0\d \/ 60:00$/);
    expect(time().className).not.toContain("text-red-700");
  });

  it("a 60-minute limit is red at 61:00", () => {
    render(<AssessVisitBar copy={COPY.en} done={2} total={3} startedAt={Date.now() - 61 * MIN} limitMs={60 * MIN} sync={[]} />);
    expect(time()).toHaveTextContent(/\/ 60:00$/);
    expect(time().className).toContain("text-red-700");
  });

  it("a 45-minute limit reads / 45:00 and is red at 50:00, as today", () => {
    render(<AssessVisitBar copy={COPY.en} done={2} total={5} startedAt={Date.now() - 50 * MIN} limitMs={45 * MIN} sync={[]} />);
    expect(time()).toHaveTextContent(/\/ 45:00$/);
    expect(time().className).toContain("text-red-700");
  });

  it("Urdu: the 60-minute limit in Urdu digits", () => {
    render(<AssessVisitBar copy={COPY.ur} done={0} total={3} startedAt={null} limitMs={60 * MIN} sync={[]} />);
    expect(time()).toHaveTextContent("وقت ⁦۰۰:۰۰ / ۶۰:۰۰⁩");
    expect(COPY.ur.timeUsed("50:00", "60:00")).toBe("وقت ⁦۵۰:۰۰ / ۶۰:۰۰⁩");
  });
});
