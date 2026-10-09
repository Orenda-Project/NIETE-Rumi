import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { ReadyTray, trayHeight, type TrayRow } from "./ReadyTray";

/**
 * bd-fmf24g.15 — ReadyTray (COMPONENTS.md §12): what is being made, one grey strip above the bottom menu holding
 * one white card with a 64px row per item. At most 2 rows; a 3rd or more adds "+N more", which opens the list.
 * A failed item's row is red and stays until she taps it. The page that shows an item hides that item's row.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

const row = (over: Partial<TrayRow> = {}): TrayRow => ({
  id: "lesson:a", feature: "lessons", what: "Lesson plan", gradeSubject: "Grade 7 · Science", title: "Transport of Water",
  state: "making", progress: 0.6, left: "~1 min left", to: "/portal/teacher/lessons/preparing?render=a", ...over,
});
const items = [
  row(),
  row({ id: "paper:b", feature: "assessment", what: "Paper", gradeSubject: "Grade 4 · Science", title: "Plants", progress: 0.35, to: "/portal/teacher/assessment/request/b" }),
  row({ id: "lesson:c", gradeSubject: "Grade 8 · Maths", title: "Linear equations", progress: 0.1, left: "~2 min left", to: "/c" }),
  row({ id: "paper:d", feature: "assessment", what: "Paper", gradeSubject: "Grade 5 · Maths", title: "Fractions", to: "/d" }),
];

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("ReadyTray", () => {
  it("nothing being made, nothing drawn", () => {
    const { container } = inRouter(<ReadyTray items={[]} onOpenList={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("one item: a grey strip, one white card, one 64px row — kind and class, 'Being made · time left', a chevron; a link to its page", () => {
    inRouter(<ReadyTray items={[items[0]]} onOpenList={() => {}} />);
    const region = screen.getByRole("region", { name: "Being made" });
    expect(classes(region)).toEqual(expect.arrayContaining(["bg-[#f3f4f6]"]));
    const link = within(region).getByRole("link");
    expect(link).toHaveAttribute("href", "/portal/teacher/lessons/preparing?render=a");
    expect(classes(link)).toEqual(expect.arrayContaining(["min-h-[64px]"]));
    expect(link).toHaveTextContent("Lesson plan · Grade 7 · Science");
    expect(link).toHaveTextContent("Being made · ~1 min left");
    expect(link).toHaveAccessibleName(/Lesson plan, Grade 7 · Science, Transport of Water\. Being made, ~1 min left/);
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it("the progress ring is the feature's colour (lessons green, papers blue)", () => {
    inRouter(<ReadyTray items={items.slice(0, 2)} onOpenList={() => {}} />);
    const rings = screen.getAllByTestId("notice-ring");
    expect(rings[0].innerHTML).toContain("#2f7a52");
    expect(rings[0].getAttribute("data-progress")).toBe("60");
    expect(rings[1].innerHTML).toContain("#1d6fd8");
  });

  it("two items are two rows and no more-row", () => {
    inRouter(<ReadyTray items={items.slice(0, 2)} onOpenList={() => {}} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("four items: the two that finish first, then '+2 more', which opens the list", () => {
    const onOpenList = vi.fn();
    inRouter(<ReadyTray items={items} onOpenList={onOpenList} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    const more = screen.getByRole("button", { name: /\+2 more/ });
    expect(classes(more)).toEqual(expect.arrayContaining(["min-h-[56px]"]));
    expect(more).toHaveTextContent("+2 more");
    expect(more).toHaveTextContent("See all");
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(more);
    expect(onOpenList).toHaveBeenCalledTimes(1);
  });

  it("the item her page already shows is left out, and the count follows", () => {
    inRouter(<ReadyTray items={items.slice(0, 3)} hideId="lesson:a" onOpenList={() => {}} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Transport of Water/)).toBeNull();
  });

  it("when only its own item is making, the strip is not drawn at all", () => {
    const { container } = inRouter(<ReadyTray items={[items[0]]} hideId="lesson:a" onOpenList={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a failed item is a red row: 'Couldn't make it · Try again', following it tells the host", () => {
    const onFollow = vi.fn();
    inRouter(<ReadyTray items={[row({ id: "paper:x", feature: "assessment", what: "Paper", state: "failed", to: "/x" })]} onFollow={onFollow} onOpenList={() => {}} />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("Couldn't make it · Try again");
    expect(link).toHaveAccessibleName(/Could?n't make it/);
    expect(classes(screen.getByText(/Couldn't make it/))).toEqual(expect.arrayContaining(["text-[#c8331f]"]));
    expect(screen.getByTestId("notice-ring").innerHTML).toContain("#fee4e2");
    fireEvent.click(link);
    expect(onFollow).toHaveBeenCalledWith("paper:x");
  });

  it("past its time the row says 'Almost done', never a countdown below zero", () => {
    inRouter(<ReadyTray items={[row({ left: "" })]} onOpenList={() => {}} />);
    expect(screen.getByRole("link")).toHaveTextContent("Being made · Almost done");
  });

  it("trayHeight is what the strip takes (the page keeps its last row above it)", () => {
    expect(trayHeight(0, false)).toBe(0);
    expect(trayHeight(1, false)).toBeGreaterThanOrEqual(64);
    expect(trayHeight(2, true)).toBeGreaterThan(trayHeight(2, false));
  });

  it("Urdu: the row's words are Urdu and the chevron turns round", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    // The host composes the time left (and the kind) in her language; the kit adds only its own words.
    inRouter(<ReadyTray items={[row({ what: "لیسن پلان", left: "~1 منٹ باقی" })]} onOpenList={() => {}} />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("تیار ہو رہا ہے");
    expect(link).toHaveTextContent(/منٹ باقی/);
    expect(link.querySelector("svg.rtl\\:rotate-180")).not.toBeNull();
  });
});

describe("the list (More)", () => {
  it("lists every item with its title on a line of its own, and the note", () => {
    inRouter(<ReadyTray items={items} listOpen note="We'll tell you here when each one is ready." onOpenList={() => {}} onCloseList={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /Being made/ });
    expect(dialog).toHaveTextContent("We'll tell you here when each one is ready.");
    for (const t of ["Transport of Water", "Plants", "Linear equations", "Fractions"]) expect(within(dialog).getByText(t)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link")).toHaveLength(4);
    expect(within(dialog).getByRole("heading")).toHaveTextContent("4");
  });

  it("the close and the dim close it", () => {
    const onCloseList = vi.fn();
    inRouter(<ReadyTray items={items} listOpen onOpenList={() => {}} onCloseList={onCloseList} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByTestId("tray-scrim"));
    expect(onCloseList).toHaveBeenCalledTimes(2);
  });
});
