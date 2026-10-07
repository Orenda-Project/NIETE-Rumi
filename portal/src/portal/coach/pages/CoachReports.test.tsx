import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getReports: vi.fn() } }));
import { coach } from "../../services/api";
import CoachReports from "./CoachReports";

/**
 * bd-o15qnr — Reports: Waiting for you, In progress, then every observation
 * grouped by day (search, Show more). A portal-started observation opens its
 * page; a WhatsApp one opens the teacher.
 */
const C = coach as any;
const R = (id: string, extra: Record<string, unknown>) => ({
  id, teacherName: "T", teacherPhone: "92300", teacherExtId: "923001110001", schoolName: "S", schoolExtId: "niete:1",
  status: "x", step: "sent", score: null, portal: true, createdAt: "2026-10-06T04:00:00Z", ...extra,
});

function page(items: any[], total = items.length, pageNo = 1) {
  return {
    success: true,
    waiting: [R("w1", { teacherName: "Bushra Ali", step: "draft" })],
    inProgress: [R("p1", { teacherName: "Uzma Riaz", step: "analysing" })],
    all: { total, page: pageNo, pageSize: 30, items },
  };
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/portal/coach/reports"]}>
      <Routes><Route path="/portal/coach/reports" element={<CoachReports />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getReports.mockResolvedValue(page([
    R("a1", { teacherName: "Mehwish Khan", createdAt: "2026-10-06T04:00:00Z", score: 72 }),
    R("a2", { teacherName: "Hina Tariq", createdAt: "2026-10-05T09:00:00Z", score: 66 }),
    R("a3", { teacherName: "Samina Ashraf", createdAt: "2026-10-05T06:00:00Z", score: 68, portal: false }),
  ], 40));
});

describe("CoachReports", () => {
  it("Waiting for you first, then In progress, each with its step", async () => {
    renderAt();
    const waiting = within(await screen.findByTestId("reports-waiting"));
    expect(waiting.getByText("Bushra Ali")).toBeInTheDocument();
    expect(waiting.getAllByText("Feedback Form").length).toBeGreaterThan(0); // bd-o15qnr.19: was "Check draft"
    expect(within(screen.getByTestId("reports-in-progress")).getByText("Uzma Riaz")).toBeInTheDocument();
  });

  it("all observations grouped by day, with the total", async () => {
    renderAt();
    const all = within(await screen.findByTestId("reports-all"));
    expect(all.getByText("40")).toBeInTheDocument();
    const days = all.getAllByTestId("report-day").map((d) => d.getAttribute("data-day"));
    expect(days).toEqual(["2026-10-06", "2026-10-05"]);
    expect(all.getByText("72%")).toBeInTheDocument();
  });

  // bd-o15qnr.19 — portal or WhatsApp, every report opens the one v2 observation page.
  it("every report opens the v2 observation page, portal and WhatsApp alike", async () => {
    renderAt();
    await screen.findByText("Mehwish Khan");
    expect(screen.getByText("Mehwish Khan").closest("a")).toHaveAttribute("href", "/portal/coach/observation/a1");
    expect(screen.getByText("Samina Ashraf").closest("a")?.getAttribute("href")).toMatch(/^\/portal\/coach\/observation\//);
  });

  it("search asks the server with the words; Show more asks for the next page", async () => {
    renderAt();
    await screen.findByText("Mehwish Khan");
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "hina" } });
    await waitFor(() => expect(C.getReports).toHaveBeenLastCalledWith(expect.objectContaining({ q: "hina", page: 1 })));
    C.getReports.mockResolvedValue(page([R("a9", { teacherName: "Next Page" })], 40, 2));
    fireEvent.click(await screen.findByRole("button", { name: /Show more/ }));
    expect(await screen.findByText("Next Page")).toBeInTheDocument();
  });
});
