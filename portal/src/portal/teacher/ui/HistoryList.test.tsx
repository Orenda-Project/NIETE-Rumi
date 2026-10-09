import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HistoryList, type HistoryGroup } from "./HistoryList";

/**
 * bd-fmf24g.2.1 — HistoryList (COMPONENTS.md §2): history grouped by day. Heading + total count; per day a
 * light 20px/300 heading with its count, then ONE white card of rows; Show more at the end; an empty state.
 * Collapsible (operator: "The Recent Lesson Plans can be toggleable") and See all (operator: "a link to 'All'"):
 * "See all ›" ends the heading row, collapsed and open, and a full-width See all REPLACES Show more.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const GROUPS: HistoryGroup[] = [
  { day: "Today", items: [{ id: "1", subject: "General Science", grade: 4, title: "How plants make their own food", extra: "Chap 1", chip: { text: "Opened", tone: "info" }, to: "/lp/1" }] },
  { day: "Yesterday", items: [
    { id: "2", subject: "Math", grade: 5, title: "Adding fractions", extra: "Chap 3", chip: { text: "WhatsApp", tone: "done" }, to: "/lp/2" },
    { id: "3", subject: "English", grade: 3, title: "Naming words around us", extra: "Chap 2", to: "/lp/3" },
  ] },
  { day: "Mon 5 Oct", items: [] },
];

describe("HistoryList", () => {
  it("heading with the total; each day with its count; one card of rows per day; empty days dropped", () => {
    inRouter(<HistoryList heading="Recent Lesson Plans" groups={GROUPS} />);
    const h = screen.getByRole("heading", { level: 2, name: /Recent Lesson Plans/ });
    expect(within(h).getByText("3")).toHaveClass("h-[26px]", "rounded-full");
    const days = screen.getAllByRole("heading", { level: 3 });
    expect(days.map((d) => d.textContent)).toEqual(["Today1", "Yesterday2"]);
    expect(days[0]).toHaveClass("text-[20px]", "font-light");
    const yesterday = screen.getByRole("region", { name: "Yesterday" });
    expect(within(yesterday).getAllByRole("link")).toHaveLength(2);
    const rows = yesterday.querySelectorAll("[data-history-row]");
    expect(classes(rows[0])).not.toContain("border-t");
    expect(classes(rows[1])).toContain("border-t");
  });

  it("Show more: a full-width 56px outline button that calls onShowMore; off when showMore is false", () => {
    const onShowMore = vi.fn();
    const { rerender } = inRouter(<HistoryList heading="Recent" groups={GROUPS} onShowMore={onShowMore} />);
    const more = screen.getByRole("button", { name: /Show more/ });
    expect(classes(more)).toEqual(expect.arrayContaining(["min-h-[56px]", "w-full", "rounded-2xl", "border-[#d1d5db]"]));
    fireEvent.click(more);
    expect(onShowMore).toHaveBeenCalledTimes(1);
    rerender(<MemoryRouter><HistoryList heading="Recent" groups={GROUPS} showMore={false} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });

  it("no rows: the dashed empty card with its label, and no Show more", () => {
    inRouter(<HistoryList heading="My papers" groups={[]} emptyLabel="No papers yet" />);
    expect(screen.getByText("No papers yet").closest("[data-empty]")).toHaveClass("border-dashed", "min-h-[160px]");
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });

  it("collapsible: the heading is a ≥56px toggle (aria-expanded); collapsed shows no rows; a tap opens it", () => {
    inRouter(<HistoryList heading="Recent Lesson Plans" groups={GROUPS} collapsible defaultOpen={false} />);
    const toggle = screen.getByRole("button", { name: /Recent Lesson Plans/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(classes(toggle)).toContain("min-h-[56px]");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("open, when given, sets it from outside; a tap still toggles until open changes", () => {
    const { rerender } = inRouter(<HistoryList heading="Recent" groups={GROUPS} collapsible open />);
    const toggle = screen.getByRole("button", { name: /Recent/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    rerender(<MemoryRouter><HistoryList heading="Recent" groups={GROUPS} collapsible open={false} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Recent/ })).toHaveAttribute("aria-expanded", "false");
    rerender(<MemoryRouter><HistoryList heading="Recent" groups={GROUPS} collapsible open /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Recent/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("See all: a ≥56px link at the end of the heading row, collapsed AND open, named with the heading", () => {
    const { rerender } = inRouter(<HistoryList heading="Recent Lesson Plans" groups={GROUPS} collapsible defaultOpen={false} seeAllTo="/portal/teacher/lessons/all" />);
    const top = screen.getByRole("link", { name: "See all Recent Lesson Plans" });
    expect(top).toHaveAttribute("href", "/portal/teacher/lessons/all");
    expect(top).toHaveTextContent("See all");
    expect(classes(top)).toEqual(expect.arrayContaining(["min-h-[56px]", "min-w-[56px]", "font-bold", "text-[#33374a]"]));
    expect(top.querySelector("svg")).toHaveClass("rtl:rotate-180");
    rerender(<MemoryRouter><HistoryList heading="Recent Lesson Plans" groups={GROUPS} collapsible defaultOpen seeAllTo="/all" /></MemoryRouter>);
    expect(screen.getAllByRole("link", { name: "See all Recent Lesson Plans" })).toHaveLength(2);
  });

  it("See all replaces Show more at the bottom: one pattern, one destination", () => {
    const onSeeAll = vi.fn();
    inRouter(<HistoryList heading="Recent" groups={GROUPS} seeAllTo="/all" onSeeAll={onSeeAll} />);
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
    const links = screen.getAllByRole("link", { name: "See all Recent" });
    expect(links).toHaveLength(2);
    const bottom = links[1];
    expect(classes(bottom)).toEqual(expect.arrayContaining(["min-h-[56px]", "w-full", "rounded-2xl", "border-[#d1d5db]"]));
    fireEvent.click(bottom);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("with a collapsible heading and See all, the chevron is the inline 22px one (fits 358px); without, the 40px circle", () => {
    const { rerender, container } = inRouter(<HistoryList heading="Recent" groups={GROUPS} collapsible seeAllTo="/all" />);
    expect(container.querySelector("[data-toggle-chevron='inline']")).not.toBeNull();
    rerender(<MemoryRouter><HistoryList heading="Recent" groups={GROUPS} collapsible /></MemoryRouter>);
    expect(container.querySelector("[data-toggle-chevron='circle']")).toHaveClass("h-10", "w-10", "rounded-full");
  });

  it("its words come from props (copy)", () => {
    inRouter(<HistoryList heading="حالیہ" groups={GROUPS} seeAllTo="/all" copy={{ seeAll: "سب دیکھیں", seeAllNamed: (h) => `سب ${h}` }} />);
    expect(screen.getAllByRole("link", { name: "سب حالیہ" })[0]).toHaveTextContent("سب دیکھیں");
  });
});
