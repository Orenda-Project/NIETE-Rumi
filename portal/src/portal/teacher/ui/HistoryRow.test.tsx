import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { HistoryRow, leadColours } from "./HistoryRow";
import { HistoryList } from "./HistoryList";
import { LRI, PDI } from "./bidi";
import { LIST_CARD } from "./styles";

/**
 * bd-fmf24g.2.1 / bd-fmf24g.16 — HistoryRow (COMPONENTS.md §2): one thing she did. The lead is the operator's
 * D6.5 "section, stacked" (9 Oct, replacing the 8 Oct grey block everywhere): a 64px column built into the row,
 * flush with its START edge and the full row height — "G4" (17px/800) white on the subject family's dark colour
 * over the subject's short form (15px/700, no period) in that dark on its light tint. Visual only: the row's
 * accessible name carries the full words. Then the title (2 lines), line 2 the extra, a chip and the action.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const halves = () => Array.from(screen.getByTestId("history-lead").children) as HTMLElement[];
const iso = (s: string) => `${LRI}${s}${PDI}`;

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("HistoryRow", () => {
  it("D6.5 lead: \"G4\" 17px/800 tabular, white on the family dark, over \"Sci\" 15px/700 (no period) in the dark on the light tint", () => {
    inRouter(<HistoryRow subject="General Science" grade={4} title="How plants make their own food" extra="Chap 1" to="/lp/1" />);
    const [top, bottom] = halves();
    expect(halves()).toHaveLength(2);
    expect(top).toHaveTextContent(/^G4$/);
    expect(classes(top)).toEqual(expect.arrayContaining(["text-[17px]", "font-extrabold", "tabular-nums", "text-white", "flex-1"]));
    expect(top).toHaveStyle({ backgroundColor: "#c62828" });
    expect(bottom).toHaveTextContent(/^Sci$/);
    expect(bottom.textContent).not.toContain(".");
    expect(classes(bottom)).toEqual(expect.arrayContaining(["text-[15px]", "font-bold", "flex-1"]));
    expect(bottom).toHaveStyle({ backgroundColor: "#f8e5e5", color: "#c62828" });
  });

  it("the colour follows the GRADE, not the subject: G10 is teal for any subject", () => {
    inRouter(<HistoryRow subject="Mathematics" grade={10} title="Quadratics" to="/lp/1" />);
    const [top, bottom] = halves();
    expect(top).toHaveTextContent(/^G10$/);
    expect(top).toHaveStyle({ backgroundColor: "#00796b" });
    expect(bottom).toHaveStyle({ backgroundColor: "#e6f2f0", color: "#00796b" });
  });

  it("bd-fmf24g.29 the lead is a ROUNDED TILE (operator pick F, 10 Oct): 4px in from the row's top and bottom, 8px from its START edge (logical, so Urdu puts it on the right), all four corners 6px; the text column keeps the 12px gap", () => {
    inRouter(<HistoryRow subject="General Science" grade={4} title="How plants make their own food" extra="Chap 1" to="/lp/1" />);
    const lead = screen.getByTestId("history-lead");
    expect(classes(lead)).toEqual(expect.arrayContaining(["ms-2", "my-1", "rounded-[6px]", "w-16", "self-stretch", "overflow-hidden"]));
    // logical properties only: nothing that would pin the tile to the physical left
    expect(classes(lead).some((c) => /^(ml-|mr-|me-|mx-|m-|mt-|mb-|rounded-(l|r|tl|tr|bl|br)|rtl:|ltr:)/.test(c))).toBe(false);
    // the row itself still has no start or vertical padding: the tile's own margins make the inset
    const link = screen.getByRole("link");
    expect(classes(link).some((c) => /^(ps-|pl-|py-|pt-|pb-|p-)/.test(c))).toBe(false);
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[76px]", "gap-3"]));
  });

  it("the column: 64px always, full row height, no start/vertical padding on the row, 12px gap", () => {
    inRouter(<HistoryRow subject="General Science" grade={4} title="How plants make their own food" extra="Chap 1" to="/lp/1" />);
    const lead = screen.getByTestId("history-lead");
    expect(classes(lead)).toEqual(expect.arrayContaining(["w-16", "shrink-0", "self-stretch", "flex-col", "whitespace-nowrap", "overflow-hidden"]));
    expect(classes(lead).some((c) => /^(p[sxy]?-|min-w|max-w)/.test(c))).toBe(false);
    const link = screen.getByRole("link");
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[76px]", "items-center", "gap-3", "pe-3.5"]));
    expect(classes(link).some((c) => /^(ps-|pl-|py-|pt-|pb-|p-)/.test(c))).toBe(false);
    expect(link.firstElementChild).toBe(lead);
    // The text keeps the row's 10px top and bottom, so a wrapped title grows the row and the column with it.
    expect(classes(screen.getByText("How plants make their own food").parentElement!)).toEqual(expect.arrayContaining(["py-2.5", "flex-1", "min-w-0"]));
  });

  it("G12 takes the same fixed 64px column as G4 (the width never follows the words)", () => {
    const { unmount } = inRouter(<HistoryRow subject="Pakistan Studies" grade={12} title="The Lahore Resolution" to="/a" />);
    const g12 = screen.getByTestId("history-lead");
    expect(halves()[0]).toHaveTextContent(/^G12$/);
    const g12Classes = classes(g12).sort();
    unmount();
    inRouter(<HistoryRow subject="Pakistan Studies" grade={4} title="The Lahore Resolution" to="/a" />);
    expect(classes(screen.getByTestId("history-lead")).sort()).toEqual(g12Classes);
    expect(g12Classes).toContain("w-16");
  });

  it("Pakistan Studies → \"Pak St\" (grade 9 colours)", () => {
    inRouter(<HistoryRow subject="Pakistan Studies" grade={9} title="The Lahore Resolution" to="/a" />);
    const [top, bottom] = halves();
    expect(bottom).toHaveTextContent(/^Pak St$/);
    expect(top).toHaveStyle({ backgroundColor: "#881337" });
    expect(bottom).toHaveStyle({ backgroundColor: "#f1e3e7", color: "#881337" });
  });

  it("the column is visual only; the row's accessible name carries the full words \"Grade 4 General Science\"", () => {
    inRouter(<HistoryRow subject="General Science" grade={4} title="How plants make their own food" extra="Chap 1" to="/lp/1" />);
    expect(screen.getByTestId("history-lead")).toHaveAttribute("aria-hidden", "true");
    const link = screen.getByRole("link", { name: /^Grade 4 General Science How plants make their own food/ });
    expect(link).toHaveAttribute("href", "/lp/1");
    expect(screen.getByText("Grade 4 General Science")).toHaveClass("sr-only");
  });

  it("the colour is chosen in ONE place (leadColours): a grade lookup, [light, dark]; no grade is neutral", () => {
    expect(leadColours({ subject: "English", grade: 4 })).toEqual({ light: "#f8e5e5", dark: "#c62828" });
    expect(leadColours({ subject: "Physics", grade: "10" })).toEqual({ light: "#e6f2f0", dark: "#00796b" });
    // the subject changes nothing
    expect(leadColours({ subject: "Urdu", grade: 4 })).toEqual(leadColours({ subject: "Computer Science", grade: 4 }));
    for (const grade of [null, undefined, "", "–"]) expect(leadColours({ subject: "English", grade })).toEqual({ light: "#f3f4f6", dark: "#33374a" });
  });

  it("inside a HistoryList the day's card (overflow-hidden, 16px corners) clips the column", () => {
    inRouter(<HistoryList heading="" groups={[{ day: "Today", items: [{ subject: "Math", grade: 5, title: "Fractions", to: "/a" }] }]} />);
    const card = screen.getByTestId("history-lead").closest("[data-history-row]")!.parentElement!;
    expect(classes(card)).toEqual(expect.arrayContaining(LIST_CARD.split(" ")));
    expect(classes(card)).toEqual(expect.arrayContaining(["overflow-hidden", "rounded-2xl"]));
  });

  it("a chevron row is a link: title (2 lines) and the extra on line 2, chevron at the end that turns in RTL", () => {
    inRouter(<HistoryRow subject="Math" grade={5} title="Adding fractions" extra="Chap 3" to="/lp/2" />);
    const link = screen.getByRole("link", { name: /Adding fractions/ });
    expect(link).toHaveAttribute("href", "/lp/2");
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[76px]", "pe-3.5"]));
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

  describe("bd-fmf24g.11 — a grade that was never settled (DC lessons whose analysis left it open)", () => {
    it.each([[undefined], [null], [""], ["  "], ["-"], ["–"], ["—"]])("grade %j: the column is the subject alone, centred on the tint, full height — never \"G–\"", (grade) => {
      inRouter(<HistoryRow subject="General Science" grade={grade as never} title="Parts of a plant" to="/dc/1" />);
      const lead = screen.getByTestId("history-lead");
      expect(halves()).toHaveLength(1);
      expect(lead).toHaveTextContent(/^Sci$/);
      expect(lead.textContent).not.toMatch(/G|Grade|[-–—]/);
      const [only] = halves();
      expect(classes(only)).toEqual(expect.arrayContaining(["flex-1", "items-center", "justify-center", "text-[15px]", "font-bold"]));
      expect(only).toHaveStyle({ backgroundColor: "#f3f4f6", color: "#33374a" });
      expect(classes(lead)).toEqual(expect.arrayContaining(["w-16", "self-stretch"]));
      // The accessible name: the subject's full words, no grade.
      expect(screen.getByRole("link", { name: /^General Science Parts of a plant/ })).toBeInTheDocument();
    });

    it("no grade and no subject: the SubjectTile book icon on grey, full height", () => {
      inRouter(<HistoryRow subject="" grade={null} title="A lesson" to="/dc/2" />);
      const lead = screen.getByTestId("history-lead");
      expect(lead.textContent).toBe("");
      expect(lead.querySelector("[data-icon='book']")).not.toBeNull();
      const [only] = halves();
      expect(classes(only)).toEqual(expect.arrayContaining(["flex-1", "items-center", "justify-center", "bg-[#f3f4f6]"]));
      expect(classes(lead)).toContain("w-16");
      expect(screen.getByRole("link", { name: /^A lesson$/ })).toBeInTheDocument();
    });

    it("a grade but no subject: \"G4\" alone on the dark, full height", () => {
      inRouter(<HistoryRow subject="" grade={4} title="A lesson" to="/dc/3" />);
      expect(halves()).toHaveLength(1);
      expect(screen.getByTestId("history-lead")).toHaveTextContent(/^G4$/);
      expect(screen.getByRole("link", { name: /^Grade 4 A lesson$/ })).toBeInTheDocument();
    });

    it("HistoryList passes a row with no grade straight through", () => {
      inRouter(<HistoryList heading="Recent" groups={[{ day: "Today", items: [{ subject: "English", title: "Naming words", to: "/dc/4" }] }]} />);
      expect(screen.getByTestId("history-lead")).toHaveTextContent(/^Eng$/);
    });
  });

  it("its words come from props (copy): the grade's short form and the spoken grade", () => {
    inRouter(<HistoryRow subject="Urdu" grade={3} title="A" action="download" isNew copy={{ grade: (g) => `جماعت ${g}`, gradeShort: (g) => `${g}`, download: "ڈاؤن لوڈ", newItem: "نیا" }} />);
    expect(halves()[0]).toHaveTextContent(/^3$/);
    expect(screen.getByText("جماعت 3 Urdu")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "ڈاؤن لوڈ" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "نیا" })).toBeInTheDocument();
  });

  describe("Urdu page (machine-drafted, review pending)", () => {
    beforeEach(async () => {
      await act(async () => { await i18n.changeLanguage("ur"); });
    });

    it("the numeral alone on top; a short Urdu subject word below at 13px; isolated digits", () => {
      inRouter(<HistoryRow subject="General Science" grade={4} title="پودے" to="/lp/1" />);
      const [top, bottom] = halves();
      expect(top.textContent).toBe(iso("4"));
      expect(top.textContent).not.toContain("G");
      expect(bottom.textContent).toBe("سائنس");
      expect(classes(bottom)).toEqual(expect.arrayContaining(["text-[13px]", "font-bold"]));
      expect(bottom).toHaveStyle({ backgroundColor: "#f8e5e5", color: "#c62828" });
    });

    it.each([
      ["English", "انگریزی"], ["Urdu", "اردو"], ["Mathematics", "ریاضی"], ["Computer Science", "کمپیوٹر"],
      ["Pakistan Studies", "پاکستان"], ["Social Studies", "معاشرتی"], ["Islamiat", "اسلامیات"],
    ])("%j → %s", (subject, ur) => {
      inRouter(<HistoryRow subject={subject} grade={12} title="A" to="/a" />);
      expect(halves()[1].textContent).toBe(ur);
      expect(halves()[0].textContent).toBe(iso("12"));
    });

    it("a subject with no Urdu short form keeps its English 4 letters, isolated (a Latin atom), at 15px", () => {
      inRouter(<HistoryRow subject="Calligraphy" grade={6} title="A" to="/a" />);
      expect(halves()[1].textContent).toBe(iso("Call"));
      expect(classes(halves()[1])).toContain("text-[15px]");
    });

    it("the accessible name: the kit's Urdu grade word with the subject's full words", () => {
      inRouter(<HistoryRow subject="General Science" grade={4} title="پودے" to="/lp/1" />);
      expect(screen.getByTestId("history-lead")).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByRole("link", { name: new RegExp(`^جماعت ${iso("4 General Science")} پودے`) })).toBeInTheDocument();
    });

    it("no grade: the Urdu subject word alone, never a dash", () => {
      inRouter(<HistoryRow subject="Mathematics" grade="–" title="A" to="/a" />);
      expect(halves()).toHaveLength(1);
      expect(screen.getByTestId("history-lead").textContent).toBe("ریاضی");
    });
  });
});
