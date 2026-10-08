import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ListRow } from "./ListRow";

/**
 * bd-fmf24g.2.1 — ListRow (COMPONENTS.md §3): a numbered thing (chapter, lesson, part). A 52px rounded-12 lead
 * with the PREFIX stacked over the NUMBER (operator's choice, 8 Oct: CHAP over 2, LP # over 4), title 16px/600
 * (2 lines) + subtitle, chip, chevron. States: used (✓ Used), locked (55%, lock, not tappable), selected.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("ListRow", () => {
  it("stacked prefix over the number in a 52px tile; the # belongs to the prefix", () => {
    inRouter(<>
      <ListRow prefix="Chap" number="2" label="Inside The Animal World" subtitle="p.29-46 · 7 lessons" to="/c/2" />
      <ListRow prefix="LP #" number="#4" label="Transport of water" to="/l/4" />
    </>);
    const [chap, lp] = screen.getAllByTestId("listrow-lead");
    expect(classes(chap)).toEqual(expect.arrayContaining(["h-[52px]", "w-[52px]", "rounded-xl", "flex-col", "bg-[#f3f4f6]"]));
    const [prefix, num] = Array.from(chap.children);
    expect(prefix).toHaveTextContent("Chap");
    expect(classes(prefix)).toEqual(expect.arrayContaining(["text-[10px]", "font-extrabold", "uppercase", "tracking-[.04em]", "text-[#6b7280]"]));
    expect(num).toHaveTextContent("2");
    expect(classes(num)).toEqual(expect.arrayContaining(["text-[20px]", "font-extrabold", "tabular-nums"]));
    expect(lp.children[0]).toHaveTextContent("LP #");
    expect(lp.children[1]).toHaveTextContent(/^4$/);
  });

  it("no prefix: the number alone; an icon replaces the number", () => {
    inRouter(<>
      <ListRow number="7" label="Part seven" to="/p" />
      <ListRow icon="worksheet" label="Worksheet" to="/w" />
    </>);
    const [bare, icon] = screen.getAllByTestId("listrow-lead");
    expect(bare).toHaveTextContent(/^7$/);
    expect(icon.querySelector("svg[data-icon='worksheet']")).not.toBeNull();
  });

  it("a link with `to`: 76px card, title 2 lines, subtitle muted, chevron that turns in RTL", () => {
    inRouter(<ListRow prefix="Chap" number="3" label="Ecosystem Explorers" subtitle="p.47-66" to="/c/3" />);
    const link = screen.getByRole("link", { name: /Ecosystem Explorers/ });
    expect(link).toHaveAttribute("href", "/c/3");
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[76px]", "rounded-2xl", "border-[#e5e7eb]", "bg-white", "gap-3.5", "ps-3", "pe-3.5"]));
    expect(screen.getByText("Ecosystem Explorers")).toHaveClass("line-clamp-2", "text-[16px]", "font-semibold");
    expect(link.querySelector("[data-chevron]")).toHaveClass("rtl:rotate-180");
  });

  it("without `to` it is a button that calls onPress (a picker selects the row in place)", () => {
    const onPress = vi.fn();
    inRouter(<ListRow prefix="Chap" number="1" label="Green Guardians" onPress={onPress} />);
    const btn = screen.getByRole("button", { name: /Green Guardians/ });
    fireEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("used: the green ✓ Used chip", () => {
    inRouter(<ListRow prefix="LP #" number="4" label="Transport" state="used" to="/l/4" />);
    const chip = screen.getByText("Used");
    expect(chip).toHaveClass("bg-[#eaf6ef]", "text-[#2f7a52]");
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("locked: 55%, a named lock, and not tappable even with `to`", () => {
    const onPress = vi.fn();
    const { container } = inRouter(<ListRow prefix="Chap" number="9" label="Later" state="locked" to="/x" onPress={onPress} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    const row = container.querySelector("[aria-disabled='true']")!;
    expect(classes(row)).toContain("opacity-[.55]");
    expect(screen.getByRole("img", { name: "Locked" })).toBeInTheDocument();
  });

  it("selected: indigo edge on the tint, tile tinted, the check instead of the chevron; current on a link, pressed on a button", () => {
    inRouter(<>
      <ListRow prefix="Chap" number="2" label="Animals" state="selected" to="/c/2" />
      <ListRow prefix="Chap" number="3" label="Ecosystems" state="selected" onPress={() => {}} />
    </>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("aria-current", "true");
    expect(classes(link)).toEqual(expect.arrayContaining(["border-2", "border-[#33374a]", "bg-[#f4f5f8]"]));
    expect(link.querySelector("[data-chevron]")).toBeNull();
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("img", { name: "Selected" })).toHaveLength(2);
    expect(classes(screen.getAllByTestId("listrow-lead")[0])).toContain("bg-[#e8e9f0]");
  });

  it("row variant: flat white, divided except the first; selected row = tint + 3px bar on the start edge", () => {
    inRouter(<>
      <ListRow prefix="Chap" number="1" label="One" variant="row" onPress={() => {}} />
      <ListRow prefix="Chap" number="2" label="Two" variant="row" first={false} state="selected" onPress={() => {}} />
    </>);
    const [one, two] = screen.getAllByRole("button");
    expect(classes(one)).not.toContain("border-t");
    expect(classes(one)).toContain("bg-white");
    expect(classes(two)).toEqual(expect.arrayContaining(["border-t", "border-[#f0f1f3]", "bg-[#f4f5f8]", "shadow-[inset_3px_0_0_#33374a]", "rtl:shadow-[inset_-3px_0_0_#33374a]"]));
  });
});
