import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getReports: vi.fn(), getPending: vi.fn() } }));
import { coach } from "../../services/api";
import { resetPendingCache } from "../ui";
import CoachReports from "./CoachReports";

/**
 * bd-o15qnr / bd-4404s7.5 — Reports as the teacher's pattern: Waiting for you and In progress as cards with their
 * four labelled segments, then Recent Observations (collapsible, by day) with See all to the All page.
 */
const C = coach as any;
const R = (id: string, extra: Record<string, unknown>) => ({
  id, teacherName: "T", teacherPhone: "92300", teacherExtId: "923001110001", schoolName: "S", schoolExtId: "niete:1",
  status: "x", step: "sent", score: null, portal: true, createdAt: "2026-10-06T04:00:00Z", ...extra,
});

function page(items: any[], total = items.length) {
  return {
    success: true,
    waiting: [R("w1", { teacherName: "Bushra Ali", step: "draft" })],
    inProgress: [R("p1", { teacherName: "Uzma Riaz", step: "analysing" })],
    all: { total, page: 1, pageSize: 30, items },
  };
}

function renderAt(path = "/portal/coach/reports") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/portal/coach/reports" element={<CoachReports />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPendingCache();
  C.getPending.mockResolvedValue({ success: true, waiting: 2, ids: ["w1", "w2"] });
  C.getReports.mockResolvedValue(page([
    R("a1", { teacherName: "Mehwish Khan", createdAt: "2026-10-06T04:00:00Z", score: 72 }),
    R("a2", { teacherName: "Hina Tariq", createdAt: "2026-10-05T09:00:00Z", score: 66 }),
    R("a3", { teacherName: "Samina Ashraf", createdAt: "2026-10-05T06:00:00Z", score: 68, portal: false }),
    R("a4", { teacherName: "Four", createdAt: "2026-10-04T06:00:00Z", score: 50 }),
    R("a5", { teacherName: "Five", createdAt: "2026-10-03T06:00:00Z", score: 51 }),
    R("a6", { teacherName: "Six Beyond Recent", createdAt: "2026-10-02T06:00:00Z", score: 52 }),
  ], 40));
});

describe("CoachReports", () => {
  it("the header carries the reports art and the shared attention banner for what waits", async () => {
    renderAt();
    expect(await screen.findByTestId("page-feature-tile")).toBeInTheDocument();
    expect(await screen.findByTestId("pending-banner")).toHaveTextContent("2 reports waiting");
    expect(screen.getByTestId("pending-banner")).toHaveAttribute("href", "/portal/coach/reports?show=waiting");
  });

  it("Waiting for you first, then In progress, each card with its four labelled segments", async () => {
    renderAt();
    const waiting = within(await screen.findByTestId("reports-waiting"));
    expect(waiting.getByText("Bushra Ali")).toBeInTheDocument();
    expect(waiting.getAllByText("Feedback Form").length).toBeGreaterThan(1); // the chip and the segment
    const segments = within(waiting.getByTestId("report-segments"));
    expect(["Analysed", "Feedback Form", "Debrief", "Sent"].every((w) => segments.getByText(w))).toBe(true);
    const progress = within(screen.getByTestId("reports-in-progress"));
    expect(progress.getByText("Uzma Riaz")).toBeInTheDocument();
    expect(progress.getAllByText("Analysing").length).toBeGreaterThan(0);
  });

  it("Recent shows her last five by day with TimeStamp times and percentages, and See all opens the All page", async () => {
    renderAt();
    const recent = within(await screen.findByTestId("reports-recent"));
    expect(recent.getAllByTestId("report-day").map((d) => d.getAttribute("data-day"))).toEqual(["2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03"]);
    expect(recent.getByText("72%")).toBeInTheDocument();
    expect(recent.getByLabelText("9:00 AM")).toBeInTheDocument(); // 04:00Z is 9:00 AM in Pakistan
    expect(recent.queryByText("Six Beyond Recent")).toBeNull();
    expect(recent.getByTestId("see-all")).toHaveAttribute("href", "/portal/coach/reports/all");
  });

  it("Recent collapses", async () => {
    renderAt();
    const recent = within(await screen.findByTestId("reports-recent"));
    const toggle = recent.getByRole("button", { name: /Recent Observations/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(recent.queryByText("Mehwish Khan")).toBeNull();
  });

  // bd-o15qnr.19 — portal or WhatsApp, every report opens the one v2 observation page.
  it("every report opens the v2 observation page, portal and WhatsApp alike", async () => {
    renderAt();
    await screen.findByText("Mehwish Khan");
    expect(screen.getByText("Mehwish Khan").closest("a")).toHaveAttribute("href", "/portal/coach/observation/a1");
    expect(screen.getByText("Samina Ashraf").closest("a")).toHaveAttribute("href", "/portal/coach/observation/a3");
    expect(screen.getByText("Bushra Ali").closest("a")).toHaveAttribute("href", "/portal/coach/observation/w1");
  });

  it("?show=waiting shows only Waiting for you, with a way to all of Reports", async () => {
    renderAt("/portal/coach/reports?show=waiting");
    await screen.findByText("Bushra Ali");
    expect(screen.queryByTestId("reports-in-progress")).toBeNull();
    expect(screen.queryByTestId("reports-recent")).toBeNull();
    expect(screen.getByRole("link", { name: "All reports" })).toHaveAttribute("href", "/portal/coach/reports");
  });

  it("search is not on this page (it lives on All, under the date range)", async () => {
    renderAt();
    await screen.findByText("Mehwish Khan");
    expect(screen.queryByPlaceholderText("Name or phone")).toBeNull();
  });
});
