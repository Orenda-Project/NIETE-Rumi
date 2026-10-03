import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DateRangeButton, DateRangeSheet } from "./DateRange";
import { DEFAULT_RANGE, pkDayMonth, RANGE_PRESETS, rangeFromSearch, rangeLabel, rangeQuery, rangeSearch, type DateRange } from "./range";

/**
 * bd-5rz1v.19 — Home's date range (deep-screens.html `.rangebtn` and the "Date range" sheet).
 * The keys are the ones GET /api/portal/progress takes (dashboard/lib/pk-range.js).
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("the ranges", () => {
  it("are the API's keys, in the sheet's order; the default is This month", () => {
    expect(RANGE_PRESETS).toEqual(["this_week", "this_month", "last_3_months", "this_year", "all"]);
    expect(DEFAULT_RANGE).toEqual({ key: "this_month" });
  });

  it.each([
    [{ key: "this_week" }, "This week"],
    [{ key: "this_month" }, "This month"],
    [{ key: "last_3_months" }, "Last 3 months"],
    [{ key: "this_year" }, "This year"],
    [{ key: "all" }, "All time"],
    [{ key: "custom", from: "2026-10-03", to: "2026-10-10" }, "3 Oct – 10 Oct"],
    [{ key: "custom", from: "2025-12-29", to: "2026-01-04" }, "29 Dec 2025 – 4 Jan 2026"],
    [{ key: "custom", from: "2026-10-03", to: "2026-10-03" }, "3 Oct"],
  ] as Array<[DateRange, string]>)("%j reads %s", (range, label) => {
    expect(rangeLabel(range)).toBe(label);
  });

  it("turn into the query the API takes", () => {
    expect(rangeQuery({ key: "this_week" })).toEqual({ range: "this_week" });
    expect(rangeQuery({ key: "custom", from: "2026-10-01", to: "2026-10-03" })).toEqual({ range: "custom", from: "2026-10-01", to: "2026-10-03" });
  });
});

describe("the range in the address (bd-5rz1v.17: Home and its lists share it)", () => {
  it.each([
    ["", { key: "this_month" }],
    ["?range=this_week", { key: "this_week" }],
    ["?range=all", { key: "all" }],
    ["?range=custom&from=2026-09-01&to=2026-09-30", { key: "custom", from: "2026-09-01", to: "2026-09-30" }],
    ["?range=forever", { key: "this_month" }],
    ["?range=custom&from=2026-09-30&to=2026-09-01", { key: "this_month" }],
    ["?range=custom&from=2026-02-30&to=2026-03-01", { key: "this_month" }],
    ["?range=custom&from=yesterday", { key: "this_month" }],
  ] as Array<[string, DateRange]>)("%j reads as %j", (search, range) => {
    expect(rangeFromSearch(new URLSearchParams(search))).toEqual(range);
  });

  it.each([
    [{ key: "this_month" }, ""],
    [{ key: "this_week" }, "?range=this_week"],
    [{ key: "custom", from: "2026-09-01", to: "2026-09-30" }, "?range=custom&from=2026-09-01&to=2026-09-30"],
  ] as Array<[DateRange, string]>)("%j writes %j (the default leaves the address clean)", (range, search) => {
    expect(rangeSearch(range)).toBe(search);
  });

  it("a moment's day and month are Pakistan's", () => {
    expect(pkDayMonth("2026-10-02T20:30:00Z")).toEqual({ day: "3", month: "Oct" });
    expect(pkDayMonth("2026-10-02T05:00:00Z")).toEqual({ day: "2", month: "Oct" });
    expect(pkDayMonth("not a date")).toBeNull();
  });
});

describe("DateRangeButton", () => {
  it("on the band: translucent white with a lighter border, calendar + label + down arrow, in a 56px target", () => {
    render(<DateRangeButton value={DEFAULT_RANGE} onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "Date range: This month" });
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    expect(classes(btn)).toContain("min-h-[56px]");
    const pill = btn.querySelector("[data-pill]")!;
    expect(classes(pill)).toEqual(expect.arrayContaining([
      "h-9", "rounded-xl", "px-3", "gap-1.5", "text-[13.5px]", "font-bold",
      "bg-nu-frame-control", "border-[1.5px]", "border-nu-frame-control-border", "text-white",
    ]));
    expect(pill.querySelectorAll("svg")).toHaveLength(2);
    expect(pill).toHaveTextContent("This month");
  });

  it("on a light page: white with a grey border and dark text", () => {
    render(<DateRangeButton value={{ key: "all" }} surface="light" onClick={() => {}} />);
    const pill = screen.getByRole("button", { name: "Date range: All time" }).querySelector("[data-pill]")!;
    expect(classes(pill)).toEqual(expect.arrayContaining(["bg-nu-surface-card", "border-nu-surface-line", "text-nu-surface-text"]));
  });

  it("opens the sheet", () => {
    const onClick = vi.fn();
    render(<DateRangeButton value={DEFAULT_RANGE} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /Date range/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("DateRangeSheet", () => {
  const sheet = (props: Partial<React.ComponentProps<typeof DateRangeSheet>> = {}) => (
    <DateRangeSheet open value={DEFAULT_RANGE} onChange={() => {}} onClose={() => {}} today="2026-10-03" {...props} />
  );

  it("is a sheet titled Date range: five presets as one choice, This month picked, then Pick dates", () => {
    render(sheet());
    const dialog = screen.getByRole("dialog", { name: "Date range" });
    const group = within(dialog).getByRole("radiogroup", { name: "Date range" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["This week", "This month", "Last 3 months", "This year", "All time"]);
    expect(within(group).getByRole("radio", { name: "This month" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("button", { name: /Pick dates/ })).toBeInTheDocument();
  });

  it("a preset applies at once and closes the sheet", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(sheet({ onChange, onClose }));
    fireEvent.click(screen.getByRole("radio", { name: "This week" }));
    expect(onChange).toHaveBeenCalledWith({ key: "this_week" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Pick dates opens From and To; Done waits for two dates in order, then applies them", () => {
    const onChange = vi.fn();
    render(sheet({ onChange }));
    fireEvent.click(screen.getByRole("button", { name: /Pick dates/ }));
    const from = screen.getByLabelText("From") as HTMLInputElement;
    const to = screen.getByLabelText("To") as HTMLInputElement;
    expect(from).toHaveAttribute("type", "date");
    expect(from).toHaveAttribute("max", "2026-10-03");
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    fireEvent.change(from, { target: { value: "2026-10-02" } });
    fireEvent.change(to, { target: { value: "2026-09-01" } });
    expect(done).toBeDisabled();
    fireEvent.change(to, { target: { value: "2026-10-03" } });
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(onChange).toHaveBeenCalledWith({ key: "custom", from: "2026-10-02", to: "2026-10-03" });
  });

  it("a custom range shows as picked: Pick dates selected with its dates, no preset checked", () => {
    render(sheet({ value: { key: "custom", from: "2026-09-01", to: "2026-09-30" } }));
    const pick = screen.getByRole("button", { name: /Pick dates/ });
    expect(pick).toHaveAttribute("aria-current", "true");
    expect(pick).toHaveTextContent("1 Sep");
    for (const r of screen.getAllByRole("radio")) expect(r).toHaveAttribute("aria-checked", "false");
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-09-01");
  });

  it("every option is at least 56px tall", () => {
    render(sheet());
    for (const r of screen.getAllByRole("radio")) expect(classes(r)).toContain("min-h-[56px]");
    fireEvent.click(screen.getByRole("button", { name: /Pick dates/ }));
    expect(classes(screen.getByLabelText("From"))).toContain("min-h-[56px]");
  });

  it("its words come in through props", () => {
    render(sheet({ copy: { title: "تاریخیں", presets: { this_week: "اس ہفتے", this_month: "اس مہینے", last_3_months: "پچھلے 3 مہینے", this_year: "اس سال", all: "سب" }, pick: "تاریخ چنیں", from: "سے", to: "تک", done: "ٹھیک" } }));
    expect(screen.getByRole("dialog", { name: "تاریخیں" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "اس مہینے" })).toHaveAttribute("aria-checked", "true");
  });
});
