import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../../newui/checks/rules";
import { DayStrip, TimePicker, SlotGroup, StepBar, RatingScale, weekOf, addDays } from "./index";

/** bd-4404s7.1 (PR 2b) — DayStrip, TimePicker, SlotGroup, StepBar, RatingScale. Canvas: Coach_NewVisit3, Coach_Team, Coach_FeedbackForm. */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("date helpers", () => {
  it("weekOf: Sunday to Saturday; addDays crosses months", () => {
    expect(weekOf("2026-10-07")).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("DayStrip", () => {
  it("shows the MONTH and year, week arrows, seven days with the picked one marked", () => {
    const onChange = vi.fn();
    const { container } = render(<DayStrip value="2026-10-07" onChange={onChange} />);
    expect(screen.getByText("October 2026")).toBeTruthy();
    const days = within(screen.getByRole("group", { name: "Day" })).getAllByRole("button").filter((b) => b.hasAttribute("data-day"));
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.getAttribute("data-day"))).toEqual(weekOf("2026-10-07"));
    expect(screen.getByRole("button", { name: "Wed 7" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Thu 8" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-08");
    expect(tapProblems(container)).toEqual([]);
  });
  it("the arrows move the shown week by seven days (and keep the pick if it is not in view)", () => {
    const onWeek = vi.fn();
    render(<DayStrip value="2026-10-07" onChange={() => {}} onWeekChange={onWeek} />);
    fireEvent.click(screen.getByRole("button", { name: "Later week" }));
    expect(onWeek).toHaveBeenCalledWith("2026-10-11");
    expect(screen.getByRole("button", { name: "Sun 11" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wed 14" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Earlier week" }));
    fireEvent.click(screen.getByRole("button", { name: "Earlier week" }));
    expect(screen.getByRole("button", { name: "Sun 27" })).toBeTruthy();
    expect(screen.getByText("Sep – Oct 2026")).toBeTruthy();
  });
  it("counts under each day (Team), weekends dimmed, a count of 0 shown", () => {
    render(<DayStrip value="2026-10-07" onChange={() => {}} counts={{ "2026-10-05": 38, "2026-10-04": 0 }} />);
    expect(screen.getByRole("button", { name: "Mon 5, 38" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sun 4, 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sun 4, 0" }).className).toMatch(/text-\[#9ca3af\]/);
  });
  it("dots for visits (open grey, done green), at most three", () => {
    const { container } = render(<DayStrip value="2026-10-07" onChange={() => {}} dots={{ "2026-10-06": ["done", "open", "open", "open"] }} />);
    const b = container.querySelector('[data-day="2026-10-06"]')!;
    expect(b.querySelectorAll("[data-dot]")).toHaveLength(3);
    expect(b.querySelector('[data-dot="done"]')).not.toBeNull();
  });
  it("Urdu: weekday words and the month in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<DayStrip value="2026-10-07" onChange={() => {}} />);
    expect(screen.getByText(/اکتوبر/)).toBeTruthy();
    expect(screen.getAllByText("اتوار").length).toBeGreaterThan(0);
  });
});

describe("TimePicker", () => {
  it("a 12-hour readout (TimeStamp) with the hour stepper, :00/:30 and AM/PM, all 56px", () => {
    const onChange = vi.fn();
    const { container } = render(<TimePicker value="09:00" onChange={onChange} caption="Wednesday 7 October" />);
    expect(screen.getAllByLabelText("9:00 AM").length).toBeGreaterThan(0);
    expect(screen.getByText("Wednesday 7 October")).toBeTruthy();
    expect(tapProblems(container)).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: ":30" }));
    expect(onChange).toHaveBeenLastCalledWith("09:30");
    fireEvent.click(screen.getByRole("radio", { name: "PM" }));
    expect(onChange).toHaveBeenLastCalledWith("21:00");
  });
  it("the hour stepper goes 7 … 12, 1 … 6 and wraps; tapping an hour picks its default AM/PM", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TimePicker value="11:30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Later hour" }));
    expect(onChange).toHaveBeenLastCalledWith("12:30"); // 12 → noon, PM by default
    rerender(<TimePicker value="12:30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Later hour" }));
    expect(onChange).toHaveBeenLastCalledWith("13:30"); // 1 PM
    rerender(<TimePicker value="18:00" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Later hour" }));
    expect(onChange).toHaveBeenLastCalledWith("07:00"); // wraps 6 PM → 7 AM
    rerender(<TimePicker value="07:00" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Earlier hour" }));
    expect(onChange).toHaveBeenLastCalledWith("18:00");
  });
  it("any half hour is allowed, a past or odd value is shown as it is", () => {
    render(<TimePicker value="14:30" onChange={() => {}} />);
    expect(screen.getAllByLabelText("2:30 PM").length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: ":30" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "PM" })).toHaveAttribute("aria-checked", "true");
  });
  it("Urdu: AM/PM words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<TimePicker value="09:00" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "صبح" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("StepBar", () => {
  it("segments up to the current step and 'Step 3 of 3'", () => {
    const { container } = render(<StepBar total={3} current={2} />);
    expect(container.querySelectorAll("[data-step]")).toHaveLength(3);
    expect(Array.from(container.querySelectorAll("[data-step]")).map((s) => s.getAttribute("data-step"))).toEqual(["on", "on", "off"]);
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Step 2 of 3" })).toBeTruthy();
  });
  it("a label of the screen's own ('Part 2 of 4') and a labelled variant", () => {
    const { container } = render(<StepBar total={2} current={1} label="Part 1 of 2" labels={["Waiting", "In progress"]} />);
    expect(screen.getByText("Part 1 of 2")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(container.querySelectorAll("[data-step]")).toHaveLength(2);
  });
  it("Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<StepBar total={3} current={3} />);
    expect(screen.getByText(/مرحلہ/)).toBeTruthy();
  });
});

describe("RatingScale", () => {
  it("1–4 and N/A as a radiogroup of 56px choices", () => {
    const onChange = vi.fn();
    const { container } = render(<RatingScale value={3} onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Rating" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["1", "2", "3", "4", "N/A"]);
    expect(screen.getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");
    expect(tapProblems(container)).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: "N/A" }));
    expect(onChange).toHaveBeenLastCalledWith("na");
    fireEvent.click(screen.getByRole("radio", { name: "1" }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
  it("nothing picked: none checked; the Digital Coach's rating gets a green ring that is also spoken", () => {
    render(<RatingScale value={null} onChange={() => {}} dcValue={2} />);
    screen.getAllByRole("radio").forEach((r) => expect(r).toHaveAttribute("aria-checked", "false"));
    const two = screen.getByRole("radio", { name: "2, Digital Coach" });
    expect(two.className).toMatch(/shadow-\[inset_0_0_0_2px_#48b078\]/);
  });
  it("arrow keys move the pick", () => {
    const onChange = vi.fn();
    render(<RatingScale value={1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "1" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
  it("a name for the group of the screen's own (the indicator)", () => {
    render(<RatingScale value={null} onChange={() => {}} name="Positive learning environment" />);
    expect(screen.getByRole("radiogroup", { name: "Positive learning environment" })).toBeTruthy();
  });
  it("Urdu: N/A is لاگو نہیں", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<RatingScale value={null} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "لاگو نہیں" })).toBeTruthy();
  });
});

describe("SlotGroup", () => {
  const people = [
    { id: "1", name: "Nasreen Akhtar", sub: "IMSG G-10/2 · You", mine: true, done: true },
    { id: "2", name: "Rubina Kausar", sub: "IMSG I-10/1 · Asma Khan", initials: "AK", done: true },
    { id: "3", name: "Tahira Parveen", sub: "IMCG F-7/2 · Sana Nasir", initials: "SN" },
    { id: "4", name: "Uzma Tariq", sub: "IMSG G-10/2", initials: "AK" },
    { id: "5", name: "Fifth Person", sub: "X", initials: "FP" },
  ];
  it("a 64px header toggle: the time, a count chip, avatars while closed", () => {
    const { container } = render(<SlotGroup time="8:30 AM" count={20} people={people} />);
    const head = screen.getByRole("button", { name: /8:30 AM/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("20 visits")).toBeTruthy();
    expect(container.querySelectorAll("[data-avatar]").length).toBeGreaterThan(0);
    expect(screen.queryByText("Nasreen Akhtar")).toBeNull();
    expect(tapProblems(container)).toEqual([]);
  });
  it("opens to rows (4), then Show all N; You is the dark avatar; a green check on done", () => {
    render(<SlotGroup time="8:30 AM" count={20} people={people} defaultOpen />);
    expect(screen.getByText("Nasreen Akhtar")).toBeTruthy();
    expect(screen.getByText("Uzma Tariq")).toBeTruthy();
    expect(screen.queryByText("Fifth Person")).toBeNull();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "Done" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show all 20" }));
    expect(screen.getByText("Fifth Person")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
  });
  it("a row with `to` is a link", () => {
    inRouter(<SlotGroup time="8:30 AM" count={1} defaultOpen people={[{ id: "1", name: "A B", sub: "S", to: "/portal/coach/visit/1" }]} />);
    expect(screen.getByRole("link", { name: /A B/ })).toHaveAttribute("href", "/portal/coach/visit/1");
  });
  it("controlled open", () => {
    const onOpenChange = vi.fn();
    render(<SlotGroup time="8:30 AM" count={2} people={people.slice(0, 2)} open onOpenChange={onOpenChange} />);
    expect(screen.getByText("Nasreen Akhtar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /8:30 AM/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("Urdu: the count and the You word", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<SlotGroup time="08:30" count={20} people={people} defaultOpen />);
    expect(screen.getByText((t) => t.replace(/[\u2066\u2069]/g, "") === "20 دورے")).toBeTruthy();
    expect(screen.getByText("آپ")).toBeTruthy();
  });
});
