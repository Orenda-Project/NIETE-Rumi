import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { ReadyCard, type ReadyCardRow } from "./ReadyCard";

/**
 * bd-fmf24g.15 — ReadyCard (COMPONENTS.md §12): Home's "Ready for you". A heading with a green count chip, one white
 * card with one 92px row per finished item (icon with a tick, the title, "Lesson plan · Grade 7 Science", a big Open),
 * at most 2 rows, then "See all", which opens the full list. The whole row is the one target.
 */
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const row = (over: Partial<ReadyCardRow> = {}): ReadyCardRow => ({
  id: "lesson:a", feature: "lessons", what: "Lesson plan", title: "Transport of Water", line: "Grade 7 · Science", ...over,
});
const three = [row(), row({ id: "paper:b", feature: "assessment", what: "Paper", title: "Plants and food", line: "Grade 4 · Science" }), row({ id: "lesson:c", title: "Linear equations", line: "Grade 8 · Maths" })];

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("ReadyCard", () => {
  it("nothing finished, nothing drawn", () => {
    const { container } = inRouter(<ReadyCard items={[]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("'Ready for you' with the count, and a row per item", () => {
    inRouter(<ReadyCard items={three.slice(0, 2)} onOpen={() => {}} />);
    const region = screen.getByRole("region", { name: "Ready for you" });
    expect(within(region).getByRole("heading", { name: /Ready for you/ })).toBeInTheDocument();
    expect(within(region).getByText("2")).toBeInTheDocument();
    const rows = within(region).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Transport of Water");
    expect(rows[0]).toHaveTextContent("Lesson plan · Grade 7 · Science");
    expect(rows[0]).toHaveTextContent("Open");
    expect(classes(rows[0])).toEqual(expect.arrayContaining(["min-h-[92px]", "w-full"]));
    expect(rows[0]).toHaveAccessibleName(/Open Transport of Water/);
  });

  it("the whole row opens the item", () => {
    const onOpen = vi.fn();
    inRouter(<ReadyCard items={three.slice(0, 2)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Plants and food/ }));
    expect(onOpen).toHaveBeenCalledWith("paper:b");
  });

  it("at most two rows and See all, which opens the whole list", () => {
    const onOpenList = vi.fn();
    inRouter(<ReadyCard items={three} onOpen={() => {}} onOpenList={onOpenList} />);
    const region = screen.getByRole("region", { name: "Ready for you" });
    expect(within(region).getAllByRole("button", { name: /^Open / })).toHaveLength(2);
    expect(within(region).getByText("3")).toBeInTheDocument();
    const seeAll = within(region).getByRole("button", { name: /See all/ });
    expect(classes(seeAll)).toEqual(expect.arrayContaining(["min-h-[56px]"]));
    fireEvent.click(seeAll);
    expect(onOpenList).toHaveBeenCalledTimes(1);
  });

  it("the list: every item, and a row there opens it too", () => {
    const onOpen = vi.fn();
    const onCloseList = vi.fn();
    inRouter(<ReadyCard items={three} onOpen={onOpen} listOpen onOpenList={() => {}} onCloseList={onCloseList} />);
    const dialog = screen.getByRole("dialog", { name: /Ready for you/ });
    expect(within(dialog).getAllByRole("button", { name: /^Open / })).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole("button", { name: /Linear equations/ }));
    expect(onOpen).toHaveBeenCalledWith("lesson:c");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onCloseList).toHaveBeenCalled();
  });

  it("Urdu: its words are Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    inRouter(<ReadyCard items={three} onOpen={() => {}} onOpenList={() => {}} />);
    expect(screen.getByRole("region", { name: "آپ کے لیے تیار" })).toBeInTheDocument();
    expect(screen.getAllByText("کھولیں").length).toBeGreaterThan(0);
  });
});
