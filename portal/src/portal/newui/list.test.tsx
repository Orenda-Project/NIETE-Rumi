import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Award, FlaskConical } from "lucide-react";
import { List, Row, ProgressBar, SectionLabel } from "./List";
import { Chip, FilterChips } from "./Chip";

/**
 * bd-5rz1v.19 — rows and chips (deep-screens.html `.list`, `.row`, `.chip`). The rule they
 * carry: information never looks tappable, and anything tappable does — a row that goes
 * somewhere has a chevron; a row that only informs has none and is not a button.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("List", () => {
  it("is a white card, 16px corners, 1.5px grey border, rows divided by 1.5px lines", () => {
    inRouter(<List label="Plans"><Row title="One" to="/a" /><Row title="Two" to="/b" /></List>);
    const list = screen.getByRole("list", { name: "Plans" });
    expect(classes(list)).toEqual(expect.arrayContaining([
      "overflow-hidden", "rounded-2xl", "border-[1.5px]", "border-nu-surface-line", "bg-nu-surface-card",
    ]));
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const li of items) expect(classes(li)).toEqual(expect.arrayContaining(["border-b-[1.5px]", "border-nu-surface-line", "last:border-b-0"]));
  });
});

describe("Row", () => {
  it("a row that goes somewhere is a link with a chevron that turns round in RTL", () => {
    inRouter(<List><Row title="Leaves make food" lead="3" to="/portal/x" chips={<Chip>Grade 4</Chip>} /></List>);
    const link = screen.getByRole("link", { name: /Leaves make food/ });
    expect(link).toHaveAttribute("href", "/portal/x");
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[60px]", "w-full", "gap-3", "px-3", "py-2.5", "active:bg-nu-ink-xlight"]));
    const chevron = link.querySelector("[data-chevron]")!;
    expect(classes(chevron)).toEqual(expect.arrayContaining(["text-nu-surface-chevron", "rtl:rotate-180"]));
  });

  it("an action row is a button with the same chevron", () => {
    const onClick = vi.fn();
    inRouter(<List><Row title="Pick dates" onClick={onClick} /></List>);
    const btn = screen.getByRole("button", { name: /Pick dates/ });
    expect(btn.querySelector("[data-chevron]")).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a row that only informs is neither a link nor a button, and has no chevron or press colour", () => {
    inRouter(<List><Row title="Grade" value="4" /></List>);
    const li = screen.getByRole("listitem");
    expect(within(li).queryByRole("link")).toBeNull();
    expect(within(li).queryByRole("button")).toBeNull();
    expect(li.querySelector("[data-chevron]")).toBeNull();
    expect(li.innerHTML).not.toMatch(/active:bg-/);
  });

  it("its 42px icon tile is neutral grey; the title is 15.5px bold; the value is dark text", () => {
    inRouter(<List><Row title="Certificates" icon={Award} value="4" to="/c" /></List>);
    const tile = screen.getByTestId("newui-row-tile");
    expect(classes(tile)).toEqual(expect.arrayContaining(["h-[42px]", "w-[42px]", "rounded-xl", "bg-nu-neutral-tile", "text-nu-neutral-icon"]));
    expect(classes(screen.getByText("Certificates"))).toEqual(expect.arrayContaining(["text-[15.5px]", "font-bold", "truncate"]));
    expect(classes(screen.getByText("4"))).toEqual(expect.arrayContaining(["font-extrabold", "text-nu-surface-text"]));
  });

  it("a lead text sits in the tile when there is no icon (a day, a lesson number)", () => {
    inRouter(<List><Row title="Parts of a plant" lead="D1" to="/d" /></List>);
    expect(screen.getByTestId("newui-row-tile")).toHaveTextContent("D1");
  });

  it("done shows the green check tile; quiet is the muted tile", () => {
    inRouter(<List><Row title="Why groups?" tile="done" to="/a" /><Row title="Locked" tile="quiet" icon={FlaskConical} to="/b" /></List>);
    const [done, quiet] = screen.getAllByTestId("newui-row-tile");
    expect(classes(done)).toEqual(expect.arrayContaining(["bg-nu-done-bg", "text-nu-done"]));
    expect(done.querySelector("svg")).not.toBeNull();
    expect(classes(quiet)).toEqual(expect.arrayContaining(["bg-nu-neutral-quiet", "text-nu-neutral-quiet-icon"]));
  });

  it("off: dimmed to 55% and not tappable", () => {
    const onClick = vi.fn();
    inRouter(<List><Row title="Skilled" state="off" onClick={onClick} /></List>);
    const btn = screen.getByRole("button", { name: /Skilled/ });
    expect(btn).toBeDisabled();
    expect(classes(btn)).toContain("opacity-55");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("selected: the indigo tint, and marked current for screen readers", () => {
    inRouter(<List><Row title="General Science" state="selected" onClick={() => {}} /></List>);
    const btn = screen.getByRole("button", { name: /General Science/ });
    expect(classes(btn)).toContain("bg-nu-select-tint");
    expect(btn).toHaveAttribute("aria-current", "true");
  });

  it("an end icon replaces the chevron (a download)", () => {
    inRouter(<List><Row title="Science · Ch 2" end={Award} onClick={() => {}} /></List>);
    const btn = screen.getByRole("button", { name: /Science/ });
    expect(btn.querySelector("[data-chevron]")).toBeNull();
    expect(btn.querySelector("[data-end]")).not.toBeNull();
  });

  it("carries a green progress bar when given one", () => {
    inRouter(<List><Row title="NIETE" progress={24} value="24%" to="/n" /></List>);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "24");
  });
});

describe("ProgressBar", () => {
  it("is green on an indigo-light track, 6px, and clamps to 0-100", () => {
    const { rerender } = render(<ProgressBar value={140} label="NIETE" />);
    const bar = screen.getByRole("progressbar", { name: "NIETE" });
    expect(classes(bar)).toEqual(expect.arrayContaining(["h-1.5", "bg-nu-progress-track", "rounded-md"]));
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(classes(bar.firstElementChild!)).toContain("bg-nu-progress");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
    rerender(<ProgressBar value={-3} label="NIETE" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("SectionLabel", () => {
  it("is a 12px uppercase muted heading with an optional count at the end", () => {
    render(<SectionLabel aside="2/5">Courses</SectionLabel>);
    const h = screen.getByRole("heading", { name: /Courses/ });
    expect(classes(h)).toEqual(expect.arrayContaining(["text-xs", "font-extrabold", "uppercase", "text-nu-surface-muted", "justify-between"]));
    expect(h).toHaveTextContent("2/5");
  });
});

describe("Chip — information, never a button", () => {
  it.each([
    ["done", ["bg-nu-chip-done-bg", "text-nu-chip-done"]],
    ["waiting", ["bg-nu-chip-warning-bg", "text-nu-chip-warning"]],
    ["error", ["bg-nu-chip-error-bg", "text-nu-chip-error"]],
    ["info", ["bg-nu-chip-info-bg", "text-nu-chip-info"]],
    ["selected", ["bg-nu-chip-selected-bg", "text-nu-chip-selected"]],
  ] as const)("%s → %j", (tone, expected) => {
    render(<Chip tone={tone}>Label</Chip>);
    expect(classes(screen.getByText("Label"))).toEqual(expect.arrayContaining([...expected]));
  });

  it("defaults to info; is a flat 11.5px pill with no border, role or press state", () => {
    render(<Chip icon={FlaskConical}>Science</Chip>);
    const chip = screen.getByText("Science");
    expect(chip.tagName).toBe("SPAN");
    expect(chip).not.toHaveAttribute("role");
    expect(classes(chip)).toEqual(expect.arrayContaining(["rounded-full", "text-[11.5px]", "font-extrabold", "bg-nu-chip-info-bg"]));
    expect(chip.className).not.toMatch(/\bborder\b|active:|shadow/);
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("on the indigo band it is translucent white", () => {
    render(<Chip surface="band">Last: Day 2</Chip>);
    expect(classes(screen.getByText("Last: Day 2"))).toEqual(expect.arrayContaining(["bg-nu-frame-translucent", "text-nu-frame-chip"]));
  });
});

describe("FilterChips — a picked filter is indigo", () => {
  const options = [
    { key: "all", label: "All 3" },
    { key: "dc", label: "Digital Coach" },
    { key: "coach", label: "Coach" },
  ] as const;

  it("is one choice: a radio group whose picked chip is indigo and others are outlined", () => {
    render(<FilterChips label="Show" options={options} value="all" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Show" });
    const [all, dc] = within(group).getAllByRole("radio");
    expect(all).toHaveAttribute("aria-checked", "true");
    expect(dc).toHaveAttribute("aria-checked", "false");
    expect(classes(all.querySelector("[data-pill]")!)).toEqual(expect.arrayContaining(["bg-nu-chip-selected-bg", "text-nu-chip-selected"]));
    expect(classes(dc.querySelector("[data-pill]")!)).toEqual(expect.arrayContaining(["bg-nu-surface-card", "border-[1.5px]", "border-nu-surface-line"]));
  });

  it("each chip is a 56px target", () => {
    render(<FilterChips label="Show" options={options} value="all" onChange={() => {}} />);
    for (const r of screen.getAllByRole("radio")) expect(classes(r)).toContain("min-h-[56px]");
  });

  it("tapping one picks it; arrow keys move the pick (reversed in RTL)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterChips label="Show" options={options} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Coach" }));
    expect(onChange).toHaveBeenLastCalledWith("coach");
    fireEvent.keyDown(screen.getByRole("radio", { name: "All 3" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("dc");
    rerender(<div dir="rtl"><FilterChips label="Show" options={options} value="dc" onChange={onChange} /></div>);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Digital Coach" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("all");
  });

  it("only the picked chip is in the tab order", () => {
    render(<FilterChips label="Show" options={options} value="dc" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Digital Coach" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Coach" })).toHaveAttribute("tabindex", "-1");
  });
});
