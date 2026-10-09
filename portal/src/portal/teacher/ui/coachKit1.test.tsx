import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../../newui/checks/rules";
import { TimeStamp, parseTime, ChosenSoFar, AttentionBanner, FeatureTile } from "./index";
import { FeatureMotionProvider } from "../icons";

/**
 * bd-4404s7.1 (PR 1) — the coach build's shared pieces: TimeStamp, ChosenSoFar, AttentionBanner, FeatureTile (+ chip).
 * Canvas: TimeStamp / ChosenSoFar / AttentionBanner / FeatureTile boards, COACH.md §0b.
 */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("parseTime", () => {
  it.each([
    ["8:30 AM", "8:30", "AM"], ["08:30", "8:30", "AM"], ["14:00", "2:00", "PM"], ["12:00", "12:00", "PM"],
    ["00:30", "12:30", "AM"], ["9:00 pm", "9:00", "PM"], ["11:30", "11:30", "AM"],
  ])("%s → %s %s", (input, hm, ap) => {
    expect(parseTime(input)).toEqual({ hm, meridiem: ap });
  });
  it("a legacy word or nothing is not a time", () => {
    expect(parseTime("morning")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe("TimeStamp", () => {
  it("the time in bold with AM/PM beside it, one name for a screen reader", () => {
    const { container } = render(<TimeStamp time="08:30" />);
    expect(screen.getByLabelText("8:30 AM")).toBeTruthy();
    expect(container.querySelector("b")?.textContent).toBe("8:30");
    expect(container.querySelector("b")?.nextElementSibling?.textContent).toBe("AM");
  });
  it("tones: neutral, next, done, overdue — each its own ink", () => {
    const inks = (["neutral", "next", "done", "overdue"] as const).map((tone) => {
      const { container, unmount } = render(<TimeStamp time="14:00" tone={tone} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.getAttribute("data-tone")).toBe(tone);
      unmount();
      return el.className;
    });
    expect(new Set(inks).size).toBe(4);
  });
  it("no box, no tile: plain text (the grade-subject tile is reserved)", () => {
    const { container } = render(<TimeStamp time="08:30" />);
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/\bbg-|\bborder|rounded|\bw-\[?\d+/);
  });
  it("size scales the time; AM/PM is smaller", () => {
    const { container } = render(<TimeStamp time="08:30" size={30} />);
    expect((container.querySelector("b") as HTMLElement).style.fontSize).toBe("30px");
    expect(parseFloat((container.querySelector("b")!.nextElementSibling as HTMLElement).style.fontSize)).toBeLessThan(30);
  });
  it("a word that is not a time is shown as it came", () => {
    render(<TimeStamp time="morning" />);
    expect(screen.getByText("morning")).toBeTruthy();
  });
  it("Urdu: صبح / شام beside the time", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    const { container } = render(<TimeStamp time="14:00" />);
    expect(container.textContent).toContain("2:00");
    expect(container.textContent).toContain("شام");
    expect(container.textContent).not.toContain("PM");
  });
});

describe("ChosenSoFar", () => {
  const items = [
    { label: "School", value: "IMSG I-10/1", onChange: vi.fn() },
    { label: "Teacher", value: "Ayesha Bibi", sub: "0399 0000123", to: "/portal/coach/new-visit?step=2" },
  ];
  it("what she chose is plain text; Change is a separate bordered 56px control", () => {
    inRouter(<ChosenSoFar items={items} />);
    expect(screen.getByText("IMSG I-10/1").closest("button, a")).toBeNull(); // information never looks like a button
    expect(screen.getByText("0399 0000123")).toBeTruthy();
    const change = screen.getByRole("button", { name: "Change School" });
    expect(change.className).toMatch(/min-h-\[56px\]/);
    expect(change.textContent).toBe("Change");
    expect(change.querySelector("[data-change-pill]")?.className).toMatch(/border/);
    fireEvent.click(change);
    expect(items[0].onChange).toHaveBeenCalledTimes(1);
  });
  it("a `to` makes Change a link", () => {
    inRouter(<ChosenSoFar items={items} />);
    expect(screen.getByRole("link", { name: "Change Teacher" })).toHaveAttribute("href", "/portal/coach/new-visit?step=2");
  });
  it("targets are 56px; the group has a name", () => {
    const { container } = inRouter(<ChosenSoFar items={items} heading="Chosen so far" />);
    expect(tapProblems(container)).toEqual([]);
    expect(screen.getByLabelText("Chosen so far")).toBeTruthy();
  });
  it("Urdu: Change is تبدیل کریں", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    inRouter(<ChosenSoFar items={items} />);
    expect(screen.getAllByText("تبدیل کریں")).toHaveLength(2);
  });
});

describe("AttentionBanner", () => {
  it("an amber 56px link with a chevron", () => {
    const { container } = inRouter(<AttentionBanner text="2 reports waiting" to="/portal/coach/reports" />);
    const a = screen.getByRole("link", { name: "2 reports waiting" });
    expect(a).toHaveAttribute("href", "/portal/coach/reports");
    expect(a.className).toMatch(/bg-\[#fef3c7\]/);
    expect(a.className).toMatch(/text-\[#b45309\]/);
    expect(tapProblems(container)).toEqual([]);
    expect(a.querySelector("svg.rtl\\:rotate-180")).not.toBeNull();
  });
  it("onPress makes it a button; neither makes it a plain note", () => {
    const fn = vi.fn();
    const { unmount } = inRouter(<AttentionBanner text="Now" onPress={fn} />);
    fireEvent.click(screen.getByRole("button", { name: "Now" }));
    expect(fn).toHaveBeenCalled();
    unmount();
    inRouter(<AttentionBanner text="Just so you know" />);
    expect(screen.getByRole("status")).toHaveTextContent("Just so you know");
  });
});

describe("FeatureTile", () => {
  it("a link tile with the feature's art, its label, and no chip by default", () => {
    const { container } = inRouter(<FeatureMotionProvider><FeatureTile feature="schedule" label="Schedule" to="/portal/coach/scheduling" /></FeatureMotionProvider>);
    const a = screen.getByRole("link", { name: "Schedule" });
    expect(a).toHaveAttribute("href", "/portal/coach/scheduling");
    expect(a.className).toMatch(/min-h-\[176px\]/);
    expect(container.querySelector('svg[data-feature-art="schedule"]')?.getAttribute("data-motion")).toBe("arrive");
    expect(container.querySelector("[data-chip]")).toBeNull();
  });
  it("a chip is a status tone under the label (waiting amber, info grey, done green)", () => {
    inRouter(<FeatureTile feature="observations" label="Observe" to="/x" chip={{ text: "2 waiting", tone: "waiting" }} />);
    const chip = screen.getByText("2 waiting");
    expect(chip.closest("[data-chip]")?.className).toMatch(/bg-\[#fef3c7\]/);
    expect(screen.getByRole("link", { name: /Observe/ })).toContainElement(chip);
  });
  it("wide is the 132px last tile", () => {
    inRouter(<FeatureTile feature="classes" label="My Classes" to="/x" wide />);
    expect(screen.getByRole("link").className).toMatch(/col-span-2/);
    expect(screen.getByRole("link").className).toMatch(/min-h-\[132px\]/);
  });
});
