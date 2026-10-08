import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReportBody, type ReportData } from "./ReportBody";

/**
 * bd-fmf24g.2.3 — ReportBody (COMPONENTS.md §8): the finished report, in the order of the bot's hero-report PNG
 * (report-v2/hero-report.template.js). Every section without data is left out — that is the whole DC / coach-visit
 * difference. No sample: the page passes the real report.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const BASE: ReportData = {
  headline: "You made fractions something every child could hold in their hands.",
  marks: 33, max: 52, teacher: "Ayesha Bibi", topic: "Fractions", date: "28 Sep 2026",
  sections: [
    { code: "B", label: "Lesson Plan Fidelity", score: 10, max: 14, why: "You followed the plan's opening." },
    { code: "C", label: "High-Leverage Practices", score: 7, max: 8, why: "You modelled each fold." },
    { code: "F", label: "Teacher Subject Knowledge", score: 9, max: 20, why: "One error went uncorrected." },
    { code: "E", label: "Classroom Environment", na: true, why: "No video." },
  ],
};

describe("ReportBody", () => {
  it("the indigo hero: eyebrow, N mark, headline, the % and the marks, name · topic · date", () => {
    render(<ReportBody data={BASE} />);
    const hero = screen.getByRole("region", { name: "Report" });
    expect(classes(hero)).toEqual(expect.arrayContaining(["bg-[#33374a]", "text-white", "rounded-[22px]"]));
    expect(within(hero).getByText("Celebrating your teaching")).toHaveClass("uppercase");
    expect(within(hero).getByText("63%")).toHaveClass("text-[48px]", "font-extrabold");
    expect(within(hero).getByText("33/52 marks")).toBeInTheDocument();
    expect(hero).toHaveTextContent("Ayesha Bibi · Fractions · 28 Sep 2026");
  });

  it("Your scores: score/max with a bar coloured by band (≥80 green, ≥60 amber, else coral), a Why line; Not assessed has no bar", () => {
    render(<ReportBody data={BASE} />);
    const scores = screen.getByRole("region", { name: "Your scores" });
    const bars = within(scores).getAllByTestId("score-bar");
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveStyle({ width: "71%" });
    expect(classes(bars[0])).toContain("bg-[#e0a52e]");
    expect(classes(bars[1])).toContain("bg-[#47ba7d]");
    expect(classes(bars[2])).toContain("bg-[#dd7a5c]");
    expect(within(scores).getByText("10/14")).toBeInTheDocument();
    expect(within(scores).getByText("Not assessed")).toBeInTheDocument();
    expect(within(scores).getAllByText("Why:")).toHaveLength(4);
  });

  it("only the sections it has: no data, no section", () => {
    render(<ReportBody data={BASE} />);
    for (const name of ["Moments to remember", "Your strength", "Your next horizon", "From your classroom", "Your journey", "Last time we asked", "Try next class"]) {
      expect(screen.queryByRole("region", { name })).toBeNull();
    }
  });

  it("a DC report: moment, strength, horizon, photos, journey, last asked, try next (green); no coach section", () => {
    render(<ReportBody data={{
      ...BASE,
      identity: "A teacher who lets the class find the answer.",
      moment: { quote: "Show your partner where Quetta is.", why: "Every pair had to find it." },
      strength: { title: "Pair work", note: "Children checked each other." },
      horizon: { title: "Check the facts", note: "Keep the capitals on the board." },
      photos: [{ src: "/p/1.jpg", cap: "Map on the board" }, { cap: "No picture" }],
      journey: { points: [44, 49, 53, 58], first: "24 Aug", last: "2 Oct", note: "Up 14 points." },
      lastAsked: { text: "Ask the back rows first.", status: "Done well", tone: "done", line: "Seen three times" },
      tryNext: "I will ask one child to point on the map.",
    }} />);
    expect(screen.getByText("“Show your partner where Quetta is.”")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Your strength" })).getByText("Pair work")).toHaveClass("text-[18px]");
    const photos = within(screen.getByRole("region", { name: "From your classroom" })).getAllByRole("img");
    expect(photos).toHaveLength(1);
    expect(photos[0]).toHaveAttribute("alt", "Map on the board");
    const journey = screen.getByRole("region", { name: "Your journey" });
    expect(within(journey).getByText("4 lessons")).toBeInTheDocument();
    expect(within(journey).getByRole("img", { name: "Scores over 4 lessons" })).toBeInTheDocument();
    expect(journey).toHaveTextContent("2 Oct · 58%");
    expect(within(screen.getByRole("region", { name: "Last time we asked" })).getByText("Done well")).toHaveClass("bg-[#eaf6ef]");
    expect(classes(screen.getByRole("region", { name: "Try next class" }))).toContain("bg-[#2f7a52]");
    expect(screen.queryByText("Your commitment")).toBeNull();
  });

  it("a coach visit: the coach's section with notes, her commitment and the closing", () => {
    render(<ReportBody data={{ ...BASE, debrief: { heading: "From Hataf", initials: "HA", note: "We talked about the strips.", commitment: "I will ask the back rows first.", closing: "We are with you." } }} />);
    const coach = screen.getByRole("region", { name: "From Hataf" });
    expect(within(coach).getByText("Your commitment")).toBeInTheDocument();
    expect(within(coach).getByText("“I will ask the back rows first.”")).toHaveClass("italic");
  });

  it("the footer: NIETE · made for her first name", () => {
    render(<ReportBody data={BASE} />);
    expect(screen.getByText("Made just for you, Ayesha")).toBeInTheDocument();
  });

  it("its words come from props (copy)", () => {
    render(<ReportBody data={BASE} copy={{ scores: "آپ کے نمبر", why: "کیوں:" }} />);
    expect(screen.getByRole("region", { name: "آپ کے نمبر" })).toBeInTheDocument();
  });
});
