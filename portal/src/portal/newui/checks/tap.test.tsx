import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Award, Download } from "lucide-react";
import { tapHeightOk, tapProblems, tapWidthOk } from "./rules";
import { MainHeading } from "../MainHeading";
import { InnerBar } from "../InnerBar";
import { List, Row } from "../List";
import { Chip, FilterChips, ToggleChips } from "../Chip";
import { Stepper } from "../Stepper";
import { BottomActions, BottomButton } from "../BottomButton";
import { MetricGrid, MetricTile } from "../MetricTile";
import { DateRangeButton, DateRangeSheet } from "../DateRange";
import { DEFAULT_RANGE } from "../range";
import { NumberGrid } from "../NumberGrid";
import { ToggleList } from "../ToggleList";
import { Sheet } from "../Sheet";
import { Hero } from "../Hero";
import { AnswerChoices } from "../Answers";

/**
 * bd-5rz1v.19 — CHECK 2: every tap target is at least 56px (DESIGN.md rule 3, TAP_MIN_PX).
 *
 * jsdom has no layout, so this asserts the CLASS CONTRACT on what each component actually
 * renders: every interactive element (button, link, input, radio, checkbox…) carries a
 * phone-size height of 56px or more (min-h-[56px], h-14, h-[58px]…), and one with no text
 * — an icon on its own — a width of 56px or more as well. Only base (phone) classes count:
 * `md:min-h-[56px]` does not make a phone target big.
 */

describe("the class contract", () => {
  it.each([
    ["min-h-[56px]", true], ["h-14", true], ["min-h-14", true], ["h-[58px]", true], ["min-h-[64px]", true], ["size-14", true],
    ["min-h-[48px]", false], ["h-10", false], ["md:min-h-[56px]", false], ["", false],
  ])("height %j → %s", (cls, ok) => {
    expect(tapHeightOk(cls)).toBe(ok);
  });

  it.each([
    ["min-w-[56px]", true], ["w-14", true], ["w-full", true], ["flex-1", true], ["min-w-[40px]", false], ["w-10", false],
  ])("width %j → %s", (cls, ok) => {
    expect(tapWidthOk(cls)).toBe(ok);
  });

  it("finds a small target (planted)", () => {
    const { container } = render(
      <div>
        <button type="button" className="h-10 w-10" aria-label="Small" />
        <a href="/x" className="min-h-[56px]">Fine</a>
        <button type="button" className="min-h-[56px]" aria-label="Narrow icon"><svg /></button>
      </div>,
    );
    expect(tapProblems(container)).toEqual([
      expect.stringMatching(/Small.*height/),
      expect.stringMatching(/Narrow icon.*width/),
    ]);
  });
});

describe("every interactive kit component is at least 56px", () => {
  function Gallery() {
    return (
      <MemoryRouter>
        <MainHeading feature="home" title="Salaam, Hataf" context={<DateRangeButton value={DEFAULT_RANGE} onClick={() => {}} />} />
        <InnerBar feature="training" crumb="Training · NIETE" title="Group Work" />
        <List>
          <Row title="Leaves make food" lead="3" to="/a" chips={<Chip>Grade 4</Chip>} />
          <Row title="Pick dates" onClick={() => {}} />
          <Row title="Skilled" state="off" onClick={() => {}} />
          <Row title="Science · Ch 2" end={Download} onClick={() => {}} />
        </List>
        <FilterChips label="Show" options={[{ key: "a", label: "All 3" }, { key: "b", label: "Coach" }]} value="a" onChange={() => {}} />
        {/* bd-5rz1v.13 — the Assessment page's pieces. */}
        <ToggleChips label="Question types" options={[{ key: "m", label: "MCQ" }, { key: "f", label: "Fill in" }]} value={["m"]} onChange={() => {}} />
        <Stepper label="Questions" value={15} min={1} max={25} onChange={() => {}} />
        <MetricGrid label="This month">
          <MetricTile feature="lessonPlans" value={14} label="Lesson plans used" to="/lp" />
          <MetricTile feature="assessment" value={4} label="Assessments made" onClick={() => {}} />
          <MetricTile wide feature="coaching" value={3} label="Coaching & observations" to="/c" />
        </MetricGrid>
        <NumberGrid label="Grade" numbers={[1, 2, 3, 4]} value={2} onChange={() => {}} />
        <ToggleList label="Grades" options={[{ key: "p", label: "Primary" }, { key: "m", label: "Middle" }]} value="p" onChange={() => {}} />
        <ToggleList mode="multi" compact label="Grades" options={[{ key: "p", label: "Primary" }]} value={[]} onChange={() => {}} />
        <Hero title="Ready" icon={Award} tone="done" />
        {/* bd-5rz1v.25 — answering one question per screen. */}
        <AnswerChoices label="Answers" options={["Shout louder", "Use the quiet signal"]} value={[1]} onChange={() => {}} />
        <AnswerChoices mode="multi" label="Answers" options={["A raised hand", "A clap"]} value={[]} onChange={() => {}} />
        <BottomActions>
          <BottomButton>Open</BottomButton>
          <BottomButton tone="outline" to="/key">Answer key</BottomButton>
          <BottomButton tone="warn">Wait</BottomButton>
          <BottomButton tone="danger">Delete</BottomButton>
          <BottomButton disabled>Later</BottomButton>
        </BottomActions>
        <Sheet open title="Account" onClose={() => {}}><span>body</span></Sheet>
      </MemoryRouter>
    );
  }

  it("on every page part the kit offers", () => {
    render(<Gallery />);
    const interactive = document.body.querySelectorAll("button, a[href], input, [role=radio], [role=checkbox]");
    expect(interactive.length).toBeGreaterThan(20);
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("including the date range sheet with its date fields open", () => {
    render(<DateRangeSheet open value={DEFAULT_RANGE} onChange={() => {}} onClose={() => {}} today="2026-10-03" />);
    fireEvent.click(screen.getByRole("button", { name: /Pick dates/ }));
    expect(document.body.querySelectorAll("input[type=date]")).toHaveLength(2);
    expect(tapProblems(document.body)).toEqual([]);
  });
});
