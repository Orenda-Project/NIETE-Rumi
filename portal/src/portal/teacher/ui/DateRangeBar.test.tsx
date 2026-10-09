import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DateRangeBar } from "./DateRangeBar";
import { resolveRange } from "./range";
import { rangeQuery } from "../../newui/range";

/**
 * bd-fmf24g.2.3 — DateRangeBar (COMPONENTS.md §9): the range at the top of an All page. A 68px card button
 * ("This month" over "1 – 8 Oct 2026") opens a Tray of presets — This week, This month (default), Last 3 months,
 * This year, All time, Select dates. Its value is the portal's own DateRange (newui/range.ts), so rangeQuery() and
 * GET /api/portal/progress read it as they already do.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const TODAY = "2026-10-08"; // a Thursday

describe("resolveRange: dates, and the previous period = the same stretch one step back", () => {
  it.each([
    [{ key: "this_week" }, "2026-10-05", "2026-10-08", "2026-09-28", "2026-10-01", "5 – 8 Oct 2026", "28 Sep – 1 Oct 2026"],
    [{ key: "this_month" }, "2026-10-01", "2026-10-08", "2026-09-01", "2026-09-08", "1 – 8 Oct 2026", "1 – 8 Sep 2026"],
    [{ key: "last_3_months" }, "2026-08-01", "2026-10-08", "2026-05-01", "2026-07-08", "1 Aug – 8 Oct 2026", "1 May – 8 Jul 2026"],
    [{ key: "this_year" }, "2026-01-01", "2026-10-08", "2025-01-01", "2025-10-08", "1 Jan – 8 Oct 2026", "1 Jan – 8 Oct 2025"],
    [{ key: "custom", from: "2026-09-01", to: "2026-09-15" }, "2026-09-01", "2026-09-15", "2026-08-17", "2026-08-31", "1 – 15 Sep 2026", "17 – 31 Aug 2026"],
  ] as const)("%j", (range, from, to, prevFrom, prevTo, span, prevSpan) => {
    expect(resolveRange(range, TODAY)).toEqual({ from, to, prevFrom, prevTo, span, prevSpan });
  });

  it("All time: no start and nothing to compare with", () => {
    expect(resolveRange({ key: "all" }, TODAY)).toEqual({ from: null, to: TODAY, prevFrom: null, prevTo: null, span: "", prevSpan: "" });
  });

  it("a month's day is clamped: 31 Mar's month compares with 1–28 Feb", () => {
    expect(resolveRange({ key: "this_month" }, "2026-03-31")).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28", prevSpan: "1 – 28 Feb 2026" });
  });

  it("across a year: \"28 Dec 2026 – 3 Jan 2027\"", () => {
    expect(resolveRange({ key: "custom", from: "2026-12-28", to: "2027-01-03" }, "2027-01-05").span).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});

describe("DateRangeBar", () => {
  it("the 68px card: calendar tile, the range's name over its dates, ⌄", () => {
    render(<DateRangeBar today={TODAY} />);
    const btn = screen.getByRole("button", { name: /This month.*1 – 8 Oct 2026/ });
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    expect(classes(btn)).toEqual(expect.arrayContaining(["min-h-[68px]", "w-full", "rounded-2xl", "bg-white", "border-[#e5e7eb]"]));
    expect(screen.getByText("This month")).toHaveClass("text-[17px]", "font-semibold");
    expect(screen.getByText("1 – 8 Oct 2026")).toHaveClass("text-[13px]");
  });

  it("the tray: six choices with their dates, This month picked", () => {
    render(<DateRangeBar today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: /This month/ }));
    const group = within(screen.getByRole("dialog", { name: "Date range" })).getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "This week, 5 – 8 Oct 2026", "This month, 1 – 8 Oct 2026", "Last 3 months, 1 Aug – 8 Oct 2026",
      "This year, 1 Jan – 8 Oct 2026", "All time", "Select dates",
    ]);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(classes(radios[0])).toContain("min-h-[64px]");
  });

  it("a preset applies at once and closes the tray, with its dates and the period to compare with", () => {
    const onChange = vi.fn();
    render(<DateRangeBar today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /This month/ }));
    fireEvent.click(screen.getByRole("radio", { name: /This week/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ key: "this_week" }, expect.objectContaining({ from: "2026-10-05", prevFrom: "2026-09-28", compareLabel: "vs 28 Sep – 1 Oct 2026" }));
    expect(rangeQuery(onChange.mock.calls[0][0])).toEqual({ range: "this_week" });
    expect(screen.getByRole("button", { name: /This week.*5 – 8 Oct 2026/ })).toBeInTheDocument();
  });

  it("All time says so and has no compare line", () => {
    const onChange = vi.fn();
    render(<DateRangeBar today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /This month/ }));
    fireEvent.click(screen.getByRole("radio", { name: "All time" }));
    expect(onChange).toHaveBeenCalledWith({ key: "all" }, expect.objectContaining({ from: null, compareLabel: "" }));
    expect(screen.getByRole("button", { name: /All time.*Everything so far/ })).toBeInTheDocument();
  });

  it("Select dates: From and To (labelled, not after today), Show waits for From ≤ To, then applies them", () => {
    const onChange = vi.fn();
    render(<DateRangeBar today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /This month/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Select dates" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    expect(from).toHaveAttribute("type", "date");
    expect(to).toHaveAttribute("max", TODAY);
    expect(from).toHaveClass("h-14");
    fireEvent.change(from, { target: { value: "2026-09-20" } });
    fireEvent.change(to, { target: { value: "2026-09-15" } });
    expect(screen.getByRole("alert")).toHaveTextContent("From after To");
    expect(screen.getByRole("button", { name: /Show/ })).toBeDisabled();
    fireEvent.change(from, { target: { value: "2026-09-01" } });
    const show = screen.getByRole("button", { name: "Show 1 – 15 Sep 2026" });
    expect(show).toBeEnabled();
    fireEvent.click(show);
    expect(onChange).toHaveBeenCalledWith({ key: "custom", from: "2026-09-01", to: "2026-09-15" }, expect.objectContaining({ compareLabel: "vs 17 – 31 Aug 2026" }));
    expect(screen.getByRole("button", { name: /Selected dates.*1 – 15 Sep 2026/ })).toBeInTheDocument();
  });

  it("controlled: shows the value it is given", () => {
    render(<DateRangeBar today={TODAY} value={{ key: "last_3_months" }} />);
    expect(screen.getByRole("button", { name: /Last 3 months.*1 Aug – 8 Oct 2026/ })).toBeInTheDocument();
  });
});
