import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../../newui/checks/rules";
import { HistoryRow } from "./HistoryRow";
import { HistoryList } from "./HistoryList";

/**
 * bd-4404s7.1 — HistoryRow's coach leads (COACH.md §0b): a round 48px avatar (person initials, a school glyph, or a short
 * score/kind), a `time` on the first line, a `next`/`done` state. The grade·subject column is reserved and unchanged.
 */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("HistoryRow lead=person", () => {
  it("a round 48px avatar with her initials, not the grade·subject column", () => {
    inRouter(<HistoryRow lead="person" title="Ayesha Bibi" extra="IMSG I-10/1" to="/t/1" />);
    const av = screen.getByTestId("history-avatar");
    expect(av).toHaveTextContent(/^AB$/);
    expect(classes(av)).toEqual(expect.arrayContaining(["h-12", "w-12", "rounded-full"]));
    expect(screen.queryByTestId("history-lead")).toBeNull();
    expect(av.getAttribute("aria-hidden")).toBe("true");
  });
  it("leadText puts a score or a kind in the same avatar", () => {
    const { unmount } = inRouter(<HistoryRow lead="person" leadText="87%" title="Ayesha Bibi" />);
    expect(screen.getByTestId("history-avatar")).toHaveTextContent("87%");
    unmount();
    inRouter(<HistoryRow lead="person" leadText="HITL" leadTone="indigo" title="Ayesha Bibi" />);
    expect(screen.getByTestId("history-avatar")).toHaveTextContent("HITL");
  });
  it("a screen-reader name for the avatar when given", () => {
    inRouter(<HistoryRow lead="person" leadText="87%" leadLabel="Score 87%" title="Ayesha Bibi" />);
    expect(screen.getByText("Score 87%").className).toMatch(/sr-only/);
  });
  it("the avatar never wears a grade colour", () => {
    inRouter(<HistoryRow lead="person" title="Ayesha Bibi" />);
    const av = screen.getByTestId("history-avatar");
    expect(av.className).toMatch(/bg-\[#e8e9f0\]/);
    expect(av.style.backgroundColor).toBe("");
  });
});

describe("HistoryRow lead=school", () => {
  it("a round avatar with a school glyph", () => {
    inRouter(<HistoryRow lead="school" title="IMSG I-10/1" extra="12 teachers" to="/s/1" />);
    const av = screen.getByTestId("history-avatar");
    expect(av.querySelector("svg")).not.toBeNull();
    expect(av.textContent).toBe("");
    expect(classes(av)).toContain("rounded-full");
  });
});

describe("HistoryRow time", () => {
  it("renders a TimeStamp on the first line, above the title", () => {
    inRouter(<HistoryRow lead="person" time="08:30" timeTone="next" title="Ayesha Bibi" extra="IMSG" />);
    const stamp = screen.getByLabelText("8:30 AM");
    const title = screen.getByText("Ayesha Bibi", { selector: "span.line-clamp-2" });
    expect(stamp.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stamp.getAttribute("data-tone")).toBe("next");
  });
  it("no time, no stamp", () => {
    inRouter(<HistoryRow lead="person" title="Ayesha Bibi" />);
    expect(document.querySelector("[data-tone]")).toBeNull();
  });
});

describe("HistoryRow state", () => {
  it("next: the tint with a 3px start bar; done: muted", () => {
    const { container, unmount } = inRouter(<HistoryRow lead="person" state="next" title="A B" />);
    expect(container.querySelector("[data-history-row]")!.className).toMatch(/bg-\[#f4f5f8\]/);
    expect(container.querySelector("[data-history-row]")!.className).toMatch(/shadow-\[inset_3px_0_0_#33374a\]/);
    unmount();
    const r = inRouter(<HistoryRow lead="person" state="done" title="A B" />);
    expect(r.container.querySelector("[data-history-row]")!.className).toMatch(/bg-\[#f9fafb\]/);
  });
});

describe("grade·subject rows are exactly as they were", () => {
  it("default lead is the grade column; no avatar", () => {
    inRouter(<HistoryRow subject="Science" grade={4} title="Plants" />);
    expect(screen.getByTestId("history-lead")).toBeTruthy();
    expect(screen.queryByTestId("history-avatar")).toBeNull();
  });
  it("a time on a grade·subject row still draws the column", () => {
    inRouter(<HistoryRow subject="Science" grade={4} title="Plants" time="14:00" />);
    expect(screen.getByTestId("history-lead")).toBeTruthy();
    expect(screen.getByLabelText("2:00 PM")).toBeTruthy();
  });
});

describe("in a list, with an untitled day", () => {
  it("a group with an empty day draws no day heading", () => {
    inRouter(<HistoryList groups={[{ day: "", items: [{ lead: "person", title: "Ayesha Bibi", to: "/a" }] }]} />);
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.getByText("Ayesha Bibi")).toBeTruthy();
  });
  it("targets stay 56px", () => {
    const { container } = inRouter(<HistoryList groups={[{ day: "Today", items: [{ lead: "school", title: "IMSG", to: "/a" }, { lead: "person", title: "A B", to: "/b", time: "09:00" }] }]} />);
    expect(tapProblems(container)).toEqual([]);
  });
});
