import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getHome: vi.fn() } }));
import { coach } from "../../services/api";
import CoachHome from "./CoachHome";

/**
 * bd-o15qnr — v2 Home (v18 Main): today's visits, the current one expanded
 * with one "Take observation" button; then a big tile per feature.
 */
const HOME = {
  today: [
    { id: "v1", teacherName: "Mehwish Khan", schoolName: "IMSG I-10/1", scheduledFor: "2026-10-06", scheduledSlot: "09:00", status: "done", current: false },
    { id: "v2", teacherName: "Ayesha Bibi", schoolName: "IMSG I-10/1", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", current: true },
    { id: "v3", teacherName: "Rabia Saleem", schoolName: "IMCG F-7/2", scheduledFor: "2026-10-06", scheduledSlot: "14:00", status: "upcoming", current: false },
  ],
  counts: { week: 6, overdue: 1, waiting: 1, inProgress: 2, teachers: 24, schools: 12 },
};

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/portal/coach"]}>
      <Routes><Route path="/portal/coach" element={<CoachHome />} /></Routes>
    </MemoryRouter>,
  );
}

describe("CoachHome", () => {
  beforeEach(() => { vi.clearAllMocks(); (coach as any).getHome.mockResolvedValue({ success: true, home: HOME }); });

  it("greets her by name", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Hataf");
  });

  it("lists today's visits in 12-hour time; the current one is marked and has Take observation", async () => {
    renderHome();
    const current = await screen.findByTestId("visit-current");
    expect(current).toHaveTextContent("Ayesha Bibi");
    expect(current).toHaveTextContent("11:30");
    expect(current).toHaveTextContent("AM");
    expect(within(current).getByRole("link", { name: /Take observation/ })).toHaveAttribute("href", "/portal/coach/visit/v2");
    expect(screen.getByText("Rabia Saleem").closest("a")).toHaveAttribute("href", "/portal/coach/visit/v3");
    const done = screen.getByText("Mehwish Khan").closest("a") as HTMLElement;
    expect(done).toHaveTextContent("9:00");
    expect(done).toHaveTextContent("Done");
  });

  it("a big tile per feature, each with one number", async () => {
    renderHome();
    const tiles = within(await screen.findByTestId("feature-tiles"));
    expect(tiles.getByRole("link", { name: /Scheduling/ })).toHaveAttribute("href", "/portal/coach/scheduling");
    expect(tiles.getByRole("link", { name: /Scheduling/ })).toHaveTextContent("6 this week");
    expect(tiles.getByRole("link", { name: /Observe/ })).toHaveAttribute("href", "/portal/coach/observe");
    expect(tiles.getByRole("link", { name: /Observe/ })).toHaveTextContent("1 waiting");
    expect(tiles.getByRole("link", { name: /Schools & teachers/ })).toHaveAttribute("href", "/portal/coach/people");
    expect(tiles.getByRole("link", { name: /Schools & teachers/ })).toHaveTextContent("24 teachers");
    expect(tiles.getByRole("link", { name: /Training/ })).toHaveAttribute("href", "/portal/training");
  });

  it("no visits today: the tiles still show, and a quiet 0", async () => {
    (coach as any).getHome.mockResolvedValue({ success: true, home: { ...HOME, today: [] } });
    renderHome();
    expect(await screen.findByTestId("feature-tiles")).toBeInTheDocument();
    expect(screen.getByTestId("todays-visits")).toHaveTextContent("0");
  });
});
