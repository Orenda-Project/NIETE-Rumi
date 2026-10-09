import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("./CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../services/api", () => ({ coach: { getPeople: vi.fn(), getReports: vi.fn() }, leader: { createSchedule: vi.fn() } }));
import { coach } from "../services/api";
import { TapRow, HUE, HubTile, ChoiceChips, SectionLabel, CoachPage } from "./ui";
import CoachPeople from "./pages/CoachPeople";
import CoachNewVisit from "./pages/CoachNewVisit";
import CoachReports from "./pages/CoachReports";

/**
 * bd-o15qnr.12 — operator: "follow the design more closely in terms of color,
 * everything is too bland on the app whereas it looks better in artifacts".
 * Each case below is a mismatch found by putting the built page next to its
 * v22 canvas artboard (versions/v23_canvas-colours-built/compare-before/).
 */
const C = coach as any;
const classOf = (el: Element | null) => (el ? el.getAttribute("class") || "" : "");

const PEOPLE = {
  success: true,
  schools: [{ schoolExtId: "niete:494", emis: "494", name: "IMCB G-9/4", teachers: 8, visits: 1, daysSinceVisit: 41, avgHitl: 58 }],
  teachers: [{ teacherExtId: "923001110005", name: "Sadia Noor", phone: "923001110005", schoolExtId: "niete:494", emis: "494", schoolName: "IMCB G-9/4", hitl: 1, dc: 0, avgHitl: 49, daysSinceVisit: 41, daysSinceTraining: 64 }],
};

function at(path: string, element: React.ReactNode, route = path.split("?")[0]) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getPeople.mockResolvedValue(PEOPLE);
});

describe("visit rows: next and done (My schedule, Pick the teacher)", () => {
  it("the next visit's card has the 2px indigo border and the lifted shadow — the grey edge does not win", () => {
    at("/x", <TapRow to="/y" emphasis>Ayesha</TapRow>);
    const c = classOf(screen.getByRole("link"));
    expect(c).toMatch(/border-2/);
    expect(c).toMatch(/border-\[#33374a\]/);
    expect(c).not.toMatch(/border-\[#e5e7eb\]/);
    expect(c).toMatch(/shadow-\[0_4px_14px_rgba\(51,55,74,0\.14\)\]/);
  });

  it("a done visit's card is #f9fafb with no shadow and a dimmed name — white does not win", () => {
    at("/x", <TapRow to="/y" muted>Mehwish</TapRow>);
    const c = classOf(screen.getByRole("link"));
    expect(c).toMatch(/bg-\[#f9fafb\]/);
    expect(c).not.toMatch(/(^|\s)bg-white(\s|$)/);
    expect(c).toMatch(/shadow-none/);
    expect(c).toMatch(/\[&_\[data-testid=name\]\]:text-\[#6b7280\]/);
  });
});

describe("feature colours", () => {
  it("the live accent is the canvas's #48b078 on #eaf6ef", () => {
    expect(HUE.green).toEqual({ fg: "#48b078", bg: "#eaf6ef" });
  });

  it("hub tiles have the canvas's 18px corners", () => {
    at("/x", <HubTile to="/y" hue="observe" icon={<i />} title="Reports" />);
    expect(classOf(screen.getByRole("link"))).toMatch(/rounded-\[18px\]/);
  });
});

describe("school icons are 12px-rounded blue tiles, not circles (Schools tab; New visit is the kit row now)", () => {
  // bd-4404s7.6: the Schools list is the exception: a coach row uses a ROUND 48px avatar (the square tile is reserved).
  const expectTile = (el: Element, size: number) => {
    const c = classOf(el);
    expect(c).toMatch(/rounded-xl/);
    expect(c).not.toMatch(/rounded-full/);
    expect((el as HTMLElement).style.width).toBe(`${size}px`);
    expect((el as HTMLElement).style.background).toBe("rgb(227, 238, 252)");
    expect((el as HTMLElement).style.color).toBe("rgb(29, 111, 216)");
  };

  it("Schools tab: a round 48px grey avatar, not the square tile", async () => {
    at("/portal/coach/people", <CoachPeople />);
    const card = await screen.findByTestId("school-card");
    // the kit's HistoryRow coach lead: a round 48px grey avatar
    const avatar = within(card).getByTestId("history-avatar");
    expect(classOf(avatar)).toMatch(/rounded-full/);
    expect(classOf(avatar)).toMatch(/h-12 w-12/);
    expect(within(card).queryByTestId("school-icon")).toBeNull();
  });

  it("New visit step 1: the kit's coach row (a round avatar, not the grade tile); step 2's school is ChosenSoFar text, no icon (bd-4404s7.3)", async () => {
    const one = at("/portal/coach/new-visit", <CoachNewVisit />);
    await screen.findByText("IMCB G-9/4");
    expect(document.querySelector("[data-history-row] [data-testid=history-lead]")).toBeNull();
    expect(document.querySelector("[data-history-row] .rounded-full")).not.toBeNull();
    expect(screen.queryByTestId("school-icon")).toBeNull();
    one.unmount();
    at("/portal/coach/new-visit?school=niete%3A494", <CoachNewVisit />);
    await screen.findByText("Step 2 of 3");
    expect(screen.queryByTestId("school-icon")).toBeNull();
  });
});

describe("heading counts on Reports are the canvas's .count pills", () => {
  it("white with a grey edge, bold; Waiting for you in amber", async () => {
    const R = (id: string, step: string) => ({ id, createdAt: "2026-10-05T09:00:00Z", teacherName: "Bushra Ali", teacherPhone: null, teacherExtId: null, schoolName: "IMS Tarnol", schoolExtId: null, status: "x", step, score: null, portal: true });
    C.getReports.mockResolvedValue({ success: true, waiting: [R("w1", "draft")], inProgress: [R("p1", "analysing")], all: { total: 128, page: 1, pageSize: 20, items: [] } });
    at("/portal/coach/reports", <CoachReports />);
    await screen.findAllByText("Bushra Ali");
    const pill = (name: RegExp) => within(screen.getByRole("heading", { name })).getByTestId("section-count").firstElementChild!;
    for (const name of [/In progress/]) {
      const c = classOf(pill(name));
      expect(c).toMatch(/bg-white/);
      expect(c).toMatch(/border-\[#e5e7eb\]/);
      expect(c).toMatch(/font-bold/);
      expect(c).toMatch(/text-\[#4b5563\]/);
      expect(c).toMatch(/h-6/);
    }
    expect(classOf(pill(/Waiting for you/))).toMatch(/bg-\[#fef3c7\]/);
  });

  it("SectionLabel keeps its chip count by default (Home's Today's visits is a .chip on the canvas)", () => {
    at("/x", <SectionLabel count={3}>Today's visits</SectionLabel>);
    expect(classOf(screen.getByTestId("section-count").firstElementChild)).toMatch(/bg-\[#f3f4f6\]/);
  });
});

describe("sort chips", () => {
  it("scroll sideways without a scrollbar track", () => {
    at("/x", <ChoiceChips label="Sort" value="a" onChange={() => {}} options={[{ value: "a", label: "A" }]} />);
    expect(classOf(screen.getByRole("radiogroup"))).toMatch(/\[scrollbar-width:none\]/);
  });
});

describe("type", () => {
  it("the pages use the portal's own font stack (the canvas's), not Tailwind's system-ui font-sans", () => {
    at("/x", <CoachPage title="Observe"><p>body</p></CoachPage>);
    const root = screen.getByRole("heading", { level: 1 }).closest("div.mx-auto");
    expect(root).not.toBeNull();
    expect(classOf(root)).not.toMatch(/(^|\s)font-sans(\s|$)/);
  });
});
