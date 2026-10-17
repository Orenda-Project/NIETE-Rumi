import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { ChoiceList, Choices, QuestionPrompt, V2Row } from "./parts";
import { ProviderTile } from "./TrainingFrame";
import { tapProblems } from "../../newui/checks/rules";

/**
 * bd-s42dye.6 — pieces the teacher's Training and the coach's Training Library share, extracted so each draws the same
 * thing: the read-only answer list (the quick check's rows, nothing to press), the question prompt, the provider tile
 * (a ring that is progress on the teacher's hub and neutral in the library), and a row that opens an outside page.
 */
describe("ChoiceList: the quick check's answer rows, read only", () => {
  it("draws the same rows as Choices, but as a list: no button, no radio, no state", () => {
    const { container } = render(<ChoiceList label="Answers" options={["A habit", "A test"]} images={[null, "https://x.test/b.png"]} />);
    const ol = container.querySelector("ol");
    expect(ol?.getAttribute("aria-label")).toBe("Answers");
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe("AA habit");
    expect(rows[1].querySelector("img")?.getAttribute("src")).toBe("https://x.test/b.png");
    expect(container.querySelectorAll("button, input, [role=radio], [role=checkbox], [aria-checked]")).toHaveLength(0);

    const live = render(<Choices label="A" options={["A habit", "A test"]} states={["idle", "idle"]} value={[]} onChange={() => {}} />).container;
    // same look: the class of a live idle row is the read-only row's class (plus focus)
    const liveRow = live.querySelector("button") as HTMLElement;
    for (const c of ["min-h-16", "border-2", "rounded-2xl", "border-[#e5e7eb]", "bg-white"]) {
      expect(rows[0].className).toContain(c);
      expect(liveRow.className).toContain(c);
    }
  });
});

describe("QuestionPrompt", () => {
  it("is the quick check's 20px bold question", () => {
    const { container } = render(<QuestionPrompt>What first?</QuestionPrompt>);
    expect(container.querySelector("p")?.className).toContain("text-[20px]");
    expect(container.textContent).toBe("What first?");
  });
});

describe("ProviderTile", () => {
  const tile = (ring: { pct: number; done: boolean; label: string } | null) => (
    <MemoryRouter><ProviderTile to="/x" testId="t" label="NIETE" logo={null} initials="N" ring={ring}><span>3 courses</span></ProviderTile></MemoryRouter>
  );
  it("with a ring is the hub's progress ring (named for a screen reader)", () => {
    const { getByTestId } = render(tile({ pct: 40, done: false, label: "40%" }));
    const ring = getByTestId("t").querySelector('[role="img"]') as HTMLElement;
    expect(ring.getAttribute("aria-label")).toBe("40%");
  });
  it("without one is the mark alone on a white tile: nothing to read as progress", () => {
    const { getByTestId } = render(tile(null));
    expect(getByTestId("t").querySelector('[role="img"]')).toBeNull();
    // no gradient style anywhere, no round ring: a white rounded tile with an edge
    expect(getByTestId("t").querySelector("[style*='gradient']")).toBeNull();
    expect(getByTestId("t").querySelector("span")?.className).toContain("rounded-[14px]");
    expect(getByTestId("t").textContent).toBe("N" + "NIETE" + "3 courses");
  });
});

describe("V2Row with an outside link", () => {
  it("is an anchor that opens a new tab, still a 56px+ target", () => {
    const { container } = render(<MemoryRouter><V2Row icon={BookOpen} title="Handout" href="https://x.test/h.pdf" testId="h" /></MemoryRouter>);
    const a = container.querySelector("a") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://x.test/h.pdf");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(tapProblems(container)).toEqual([]);
  });
});
