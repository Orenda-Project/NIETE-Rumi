import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BookOpen, ChevronRight } from "lucide-react";
import { BottomButton, BottomActions } from "./BottomButton";
import { RecordingBarShownContext } from "../lib/recordingBarShown";
import { MetricGrid, MetricTile } from "./MetricTile";
import { Chip } from "./Chip";

/**
 * bd-5rz1v.19 — the bottom action button (deep-screens.html `.cta`, `.ctas`) and Home's metric
 * tiles (`.mgrid`, `.mt`). Every primary button in every feature is the same green pill.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("BottomButton", () => {
  it("primary: a 58px green pill with its darker edge, white 17.5px/800 label", () => {
    render(<BottomButton icon={BookOpen}>Open</BottomButton>);
    const btn = screen.getByRole("button", { name: "Open" });
    expect(classes(btn)).toEqual(expect.arrayContaining([
      "h-[58px]", "min-h-[56px]", "w-full", "rounded-full", "bg-nu-button", "text-white", "shadow-nu-button",
      "text-[17.5px]", "font-extrabold", "gap-2.5",
    ]));
    expect(btn).toHaveAttribute("type", "button");
  });

  it("presses down 3px onto its edge; the movement only animates when motion is allowed", () => {
    render(<BottomButton>Open</BottomButton>);
    const btn = screen.getByRole("button", { name: "Open" });
    expect(classes(btn)).toEqual(expect.arrayContaining([
      "active:translate-y-[3px]", "active:shadow-nu-button-pressed", "motion-safe:transition-transform",
    ]));
    expect(classes(btn)).not.toContain("transition-transform");
  });

  it.each([
    ["outline", ["bg-nu-button-secondary", "border-2", "border-nu-button-secondary-border", "text-nu-surface-text", "h-14", "text-base"]],
    ["warn", ["bg-nu-button-warning", "text-white", "shadow-nu-warning", "active:shadow-nu-warning-pressed"]],
    ["danger", ["bg-nu-button-destructive", "text-white", "shadow-nu-destructive", "active:shadow-nu-destructive-pressed"]],
  ] as const)("%s → %j", (tone, expected) => {
    render(<BottomButton tone={tone}>Go</BottomButton>);
    expect(classes(screen.getByRole("button", { name: "Go" }))).toEqual(expect.arrayContaining(expected as unknown as string[]));
  });

  it("disabled: grey with no edge, no press, and not clickable", () => {
    const onClick = vi.fn();
    render(<BottomButton disabled onClick={onClick}>Open</BottomButton>);
    const btn = screen.getByRole("button", { name: "Open" });
    expect(btn).toBeDisabled();
    expect(classes(btn)).toEqual(expect.arrayContaining(["bg-nu-button-disabled", "text-nu-button-disabled-text", "shadow-none"]));
    expect(classes(btn)).not.toContain("bg-nu-button");
    expect(btn.className).not.toMatch(/active:translate/);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a 23px icon; a directional one turns round in RTL", () => {
    render(<BottomButton icon={ChevronRight} iconFlips>Next</BottomButton>);
    const svg = screen.getByRole("button", { name: "Next" }).querySelector("svg")!;
    expect(classes(svg)).toEqual(expect.arrayContaining(["h-[23px]", "w-[23px]", "rtl:-scale-x-100"]));
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("can be a link (to=) with the same look", () => {
    render(<MemoryRouter><BottomButton to="/portal/curriculum">Open</BottomButton></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", "/portal/curriculum");
    expect(classes(link)).toContain("bg-nu-button");
  });
});

describe("BottomActions", () => {
  it("on a phone sits above the menu bar (80px + safe area), 2/14/14px padding, 10px between buttons; on a desktop it is inline", () => {
    render(<BottomActions><BottomButton>Download</BottomButton><BottomButton tone="outline">Answer key</BottomButton></BottomActions>);
    const panel = screen.getByTestId("newui-bottom-actions");
    expect(classes(panel)).toEqual(expect.arrayContaining([
      "fixed", "inset-x-0", "bottom-[calc(80px+env(safe-area-inset-bottom))]", "bg-nu-surface",
      "px-[14px]", "pb-[14px]", "pt-0.5", "gap-2.5", "flex-col", "md:static", "md:px-0",
    ]));
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  // bd-5rz1v.26 — the bar is now an opaque strip on the menu (80px, 8px, the 56px bar): the
  // buttons stand exactly on its top, 144px up, with their own 14px below the button.
  it("bd-5rz1v.14: while the recording bar shows, it rises above the bar (80px + 8px + 56px bar)", () => {
    render(
      <RecordingBarShownContext.Provider value>
        <BottomActions><BottomButton>Open</BottomButton></BottomActions>
      </RecordingBarShownContext.Provider>,
    );
    const panel = screen.getByTestId("newui-bottom-actions");
    expect(classes(panel)).toContain("bottom-[calc(144px+env(safe-area-inset-bottom))]");
    expect(classes(panel)).not.toContain("bottom-[calc(80px+env(safe-area-inset-bottom))]");
  });

  it("keeps room in the page for itself, so it never covers the last row", () => {
    render(<BottomActions><BottomButton>Download</BottomButton></BottomActions>);
    const spacer = screen.getByTestId("newui-bottom-actions-spacer");
    expect(spacer).toHaveAttribute("aria-hidden", "true");
    expect(classes(spacer)).toContain("md:hidden");
  });
});

describe("MetricTile", () => {
  it("is a tile link: neutral icon tile with the FEATURE's colour, a 28px number, a 13px muted label", () => {
    render(<MemoryRouter><MetricTile feature="lessonPlans" value={14} label="Lesson plans used" to="/portal/dashboard/lesson-plans" /></MemoryRouter>);
    const tile = screen.getByRole("link", { name: /14.*Lesson plans used/ });
    expect(tile).toHaveAttribute("href", "/portal/dashboard/lesson-plans");
    expect(classes(tile)).toEqual(expect.arrayContaining([
      "min-h-[104px]", "flex-col", "items-start", "gap-1.5", "p-3.5", "rounded-[18px]", "border-[1.5px]",
      "border-nu-surface-line", "bg-nu-surface-card", "active:bg-nu-ink-xlight", "text-start",
    ]));
    const icon = tile.querySelector("[data-icon]")!;
    expect(classes(icon)).toEqual(expect.arrayContaining(["h-10", "w-10", "rounded-xl", "bg-nu-neutral-tile"]));
    expect(classes(icon.querySelector("svg")!)).toContain("text-nu-f-lesson-plans-crumb");
    expect(classes(screen.getByText("14"))).toEqual(expect.arrayContaining(["text-[28px]", "font-extrabold", "leading-none", "tabular-nums"]));
    expect(classes(screen.getByText("Lesson plans used"))).toEqual(expect.arrayContaining(["text-[13px]", "font-bold", "text-nu-surface-muted"]));
  });

  it("shows — when there is no number (loading, or the API failed)", () => {
    render(<MemoryRouter><MetricTile feature="training" value={null} label="Training modules done" to="/t" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /—.*Training modules done/ })).toBeInTheDocument();
  });

  it("the dash comes in through props too", () => {
    render(<MemoryRouter><MetricTile feature="training" value={null} label="Training" to="/t" emptyValue="-" /></MemoryRouter>);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("wide: spans the whole row, icon beside the number and label, with its chips", () => {
    render(
      <MemoryRouter>
        <MetricTile wide feature="coaching" value={3} label="Coaching & observations" to="/c"
          chips={<><Chip>1 Digital Coach</Chip><Chip>2 Visits</Chip></>} />
      </MemoryRouter>,
    );
    const tile = screen.getByRole("link", { name: /3.*Coaching & observations/ });
    expect(classes(tile)).toEqual(expect.arrayContaining(["col-span-2", "md:col-span-4", "flex-row", "items-center", "min-h-[72px]"]));
    expect(tile).toHaveTextContent("1 Digital Coach");
    expect(classes(tile.querySelector("[data-icon] svg")!)).toContain("text-nu-f-coaching-crumb");
  });

  it("can be a button", () => {
    const onClick = vi.fn();
    render(<MetricTile feature="assessment" value={4} label="Assessments made" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /4.*Assessments made/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("MetricGrid", () => {
  it("two columns on a phone, four on a desktop, 10px apart", () => {
    render(<MetricGrid label="This month"><span>x</span></MetricGrid>);
    const grid = screen.getByRole("group", { name: "This month" });
    expect(classes(grid)).toEqual(expect.arrayContaining(["[display:grid]", "grid-cols-2", "md:grid-cols-4", "gap-2.5"]));
    // Not `.grid`: index.css forces that LTR in Urdu, and Home's first tile must sit on the right.
    expect(classes(grid)).not.toContain("grid");
  });
});
