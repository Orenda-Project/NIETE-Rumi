import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.17 (UI half) — the new Home: "what you did" for a date range (deep-screens.html,
 * Home). The flat indigo band with the NIETE mark, "Salaam, <first name>" and her avatar; the
 * date range (default This month); five tiles; no rating up front. Data from
 * GET /api/portal/progress (bd-5rz1v.15, dashboard/services/progress.service.js).
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children, ownHeading }: { children: React.ReactNode; ownHeading?: boolean }) => (
    <div data-testid="layout" data-own-heading={String(Boolean(ownHeading))}>{children}</div>
  ),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import { useAuth } from "../../hooks/useAuth";
import api from "../../services/api";
import NewHome from "./NewHome";
import { isAccountSheetOpen, closeAccountSheet } from "../accountSheet";

const COUNTS = {
  success: true,
  range: { key: "this_month", from: "2026-10-01", to: "2026-10-03", timezone: "Asia/Karachi" },
  lessonPlans: { used: 14, opened: 9, received: 8, days: 9 },
  training: { completed: 6 },
  coaching: { total: 3, digitalCoach: 1, observations: 2 },
  assessments: { made: 4 },
  attendance: { days: 18, registers: 22, unit: "days" },
};

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderHome(path = "/portal/dashboard") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Hataf", lastName: "Atif", role: "teacher", phoneNumber: "923001234567" },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/dashboard" element={<><NewHome /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tile = (name: RegExp) => screen.getByRole("link", { name });

beforeEach(() => {
  vi.clearAllMocks();
  act(() => closeAccountSheet());
  vi.mocked(api.get).mockResolvedValue({ data: COUNTS });
});

describe("Home — the band", () => {
  it("is a main page: the flat indigo band with the NIETE mark and 'Salaam, <first name>'", async () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: "Salaam, Hataf" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-heading-tile").tagName).toBe("IMG");
    expect(screen.getByTestId("layout")).toHaveAttribute("data-own-heading", "true");
    await screen.findByText("14");
  });

  it("carries her avatar, which opens the account sheet; on a desktop the top bar has it instead", async () => {
    renderHome();
    const avatar = within(screen.getByTestId("newui-main-heading")).getByRole("button", { name: "Account" });
    expect(avatar).toHaveTextContent("H");
    expect(avatar.closest(".md\\:hidden")).not.toBeNull();
    fireEvent.click(avatar);
    expect(isAccountSheetOpen()).toBe(true);
    await screen.findByText("14");
  });

  it("holds the date range, This month by default, and asks the API for it", async () => {
    renderHome();
    const ctx = screen.getByTestId("newui-heading-context");
    expect(within(ctx).getByRole("button", { name: "Date range: This month" })).toBeInTheDocument();
    await screen.findByText("14");
    expect(api.get).toHaveBeenCalledWith("/progress", { params: { range: "this_month" } });
  });
});

describe("Home — five tiles, no rating", () => {
  it("shows the five counts in the mockup's order", async () => {
    renderHome();
    await screen.findByText("14");
    const grid = screen.getByRole("group", { name: "This month" });
    const names = within(grid).getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual([
      "14Lesson plans used",
      "6Training modules done",
      "4Assessments made",
      "18Attendance marked",
      "3Coaching & observations1 Digital Coach2 Visits",
    ]);
  });

  it("the coaching tile is the wide one, with 'n Digital Coach' and 'n Visits' chips", async () => {
    renderHome();
    await screen.findByText("14");
    const coaching = tile(/Coaching & observations/);
    expect(coaching.className).toMatch(/\bcol-span-2\b/);
    expect(within(coaching).getByText("1 Digital Coach")).toBeInTheDocument();
    expect(within(coaching).getByText("2 Visits")).toBeInTheDocument();
  });

  it("says 1 Visit, not 1 Visits", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...COUNTS, coaching: { total: 2, digitalCoach: 1, observations: 1 } } });
    renderHome();
    expect(await screen.findByText("1 Visit")).toBeInTheDocument();
  });

  it("has no rating up front: no band word, no score, no percentage", async () => {
    renderHome();
    await screen.findByText("14");
    const text = document.body.textContent || "";
    expect(text).not.toMatch(/Excellent|Good|Average|Needs support|Below average|%|score/i);
  });

  it("each tile goes to its list: lesson plans and coaching inside Home, the rest to their pages", async () => {
    renderHome();
    await screen.findByText("14");
    expect(tile(/Lesson plans used/)).toHaveAttribute("href", "/portal/dashboard/lesson-plans");
    expect(tile(/Coaching & observations/)).toHaveAttribute("href", "/portal/dashboard/coaching");
    expect(tile(/Training modules done/)).toHaveAttribute("href", "/portal/training");
    expect(tile(/Assessments made/)).toHaveAttribute("href", "/portal/curriculum?tab=assessment");
    expect(tile(/Attendance marked/)).toHaveAttribute("href", "/portal/classes");
  });

  it("every target on the page is at least 56px", async () => {
    renderHome();
    await screen.findByText("14");
    expect(tapProblems(document.body)).toEqual([]);
  });
});

describe("Home — when the numbers are not there", () => {
  it("shows — on every tile while loading", () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    renderHome();
    const grid = screen.getByRole("group", { name: "This month" });
    expect(within(grid).getAllByText("—")).toHaveLength(5);
  });

  it("shows — on every tile when the API fails, never a blank or a crash", async () => {
    vi.mocked(api.get).mockRejectedValue(Object.assign(new Error("500"), { response: { status: 500 } }));
    renderHome();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    const grid = screen.getByRole("group", { name: "This month" });
    expect(within(grid).getAllByText("—")).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "Salaam, Hataf" })).toBeInTheDocument();
    expect(within(grid).getAllByRole("link")).toHaveLength(5);
  });

  it("an answer from an older API with a count missing still renders", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, lessonPlans: { used: 2 } } });
    renderHome();
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "This month" })).getAllByText("—")).toHaveLength(4);
  });
});

describe("Home — the date range", () => {
  it("picking a range asks again, keeps it in the address, and the lists open with it", async () => {
    renderHome();
    await screen.findByText("14");
    fireEvent.click(screen.getByRole("button", { name: "Date range: This month" }));
    fireEvent.click(await screen.findByRole("radio", { name: "This week" }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/progress", { params: { range: "this_week" } }));
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/dashboard?range=this_week");
    expect(screen.getByRole("button", { name: "Date range: This week" })).toBeInTheDocument();
    expect(tile(/Lesson plans used/)).toHaveAttribute("href", "/portal/dashboard/lesson-plans?range=this_week");
    expect(tile(/Coaching & observations/)).toHaveAttribute("href", "/portal/dashboard/coaching?range=this_week");
  });

  it("reads a custom range from the address", async () => {
    renderHome("/portal/dashboard?range=custom&from=2026-09-01&to=2026-09-30");
    await screen.findByText("14");
    expect(api.get).toHaveBeenCalledWith("/progress", { params: { range: "custom", from: "2026-09-01", to: "2026-09-30" } });
    expect(screen.getByRole("button", { name: "Date range: 1 Sep – 30 Sep" })).toBeInTheDocument();
  });

  it("an address it cannot read falls back to This month", async () => {
    renderHome("/portal/dashboard?range=forever");
    await screen.findByText("14");
    expect(api.get).toHaveBeenCalledWith("/progress", { params: { range: "this_month" } });
  });
});
