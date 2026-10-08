import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HistoryRow } from "./HistoryRow";

/**
 * bd-fmf24g.2.1 — HistoryRow (COMPONENTS.md §2): one thing she did. The lead is the operator's "block"
 * (8 Oct): a 96px grey block, "Grade 4" over the subject at the SAME 16px/700, the subject's full name when it
 * fits, else a longer abbreviation ending in a period. Title 16px/600 (2 lines), line 2 the extra, then a chip
 * and the action: a chevron link, a 56px download button, or nothing.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("HistoryRow", () => {
  it("block lead: \"Grade 4\" over \"Science\", both 16px/700, in a 96px grey block", () => {
    inRouter(<HistoryRow subject="General Science" grade={4} title="How plants make their own food" extra="Chap 1" to="/lp/1" />);
    const block = screen.getByTestId("history-lead");
    expect(classes(block)).toEqual(expect.arrayContaining(["w-24", "min-h-[58px]", "rounded-xl", "bg-[#f3f4f6]"]));
    const lines = Array.from(block.children);
    expect(lines.map((l) => l.textContent)).toEqual(["Grade 4", "Science"]);
    for (const l of lines) expect(classes(l)).toEqual(expect.arrayContaining(["text-[16px]", "font-bold", "whitespace-nowrap"]));
  });

  it("a chevron row is a link: title (2 lines) and the extra on line 2, chevron at the end that turns in RTL", () => {
    inRouter(<HistoryRow subject="Math" grade={5} title="Adding fractions" extra="Chap 3" to="/lp/2" />);
    const link = screen.getByRole("link", { name: /Adding fractions/ });
    expect(link).toHaveAttribute("href", "/lp/2");
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[76px]", "ps-3", "pe-3.5"]));
    expect(screen.getByText("Adding fractions")).toHaveClass("text-[16px]", "font-semibold", "line-clamp-2");
    expect(screen.getByText("Chap 3")).toHaveClass("text-[13px]", "text-[#6b7280]");
    expect(link.querySelector("[data-chevron]")).toHaveClass("rtl:rotate-180");
  });

  it("chip and the red New dot", () => {
    inRouter(<HistoryRow subject="Math" grade={5} title="Fractions" extra="Hataf" chip={{ text: "68%", tone: "score" }} isNew to="/o/1" />);
    expect(screen.getByText("68%")).toHaveClass("bg-[#e8e9f0]", "text-[#33374a]");
    expect(screen.getByRole("img", { name: "New" })).toHaveClass("h-[9px]", "w-[9px]", "bg-[#c8331f]");
  });

  it("download: no link; a 56px button that calls onAction", () => {
    const onAction = vi.fn();
    inRouter(<HistoryRow subject="Math" grade={5} title="Fractions" extra="20 questions" chip={{ text: "Ready", tone: "done" }} action="download" onAction={onAction} />);
    expect(screen.queryByRole("link")).toBeNull();
    const btn = screen.getByRole("button", { name: "Download" });
    expect(classes(btn)).toEqual(expect.arrayContaining(["h-14", "w-14"]));
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("none: information only — neither link nor button", () => {
    const { container } = inRouter(<HistoryRow subject="Science" grade={4} title="Plants" chip={{ text: "Writing", tone: "waiting" }} action="none" />);
    expect(within(container).queryByRole("link")).toBeNull();
    expect(within(container).queryByRole("button")).toBeNull();
  });

  it("first has no divider; later rows a 1px #f0f1f3 line", () => {
    const { container } = inRouter(<>
      <HistoryRow subject="Urdu" grade={3} title="A" to="/a" />
      <HistoryRow subject="Urdu" grade={3} title="B" to="/b" first={false} />
    </>);
    const rows = container.querySelectorAll("[data-history-row]");
    expect(classes(rows[0])).not.toContain("border-t");
    expect(classes(rows[1])).toEqual(expect.arrayContaining(["border-t", "border-[#f0f1f3]"]));
  });

  it("its words come from props (copy)", () => {
    inRouter(<HistoryRow subject="Urdu" grade={3} title="A" action="download" isNew copy={{ grade: (g) => `جماعت ${g}`, download: "ڈاؤن لوڈ", newItem: "نیا" }} />);
    expect(screen.getByTestId("history-lead")).toHaveTextContent("جماعت 3");
    expect(screen.getByRole("button", { name: "ڈاؤن لوڈ" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "نیا" })).toBeInTheDocument();
  });
});
