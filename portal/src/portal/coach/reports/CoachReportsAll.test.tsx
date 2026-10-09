import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getReports: vi.fn(), getPending: vi.fn() } }));
import { coach } from "../../services/api";
import { resetPendingCache } from "../ui";
import CoachReportsAll from "./CoachReportsAll";

/**
 * bd-4404s7.5 — All Observations: the date range, search under it, four numbers counted from the real rows (with the
 * change against the period before), and the rows by day. Today is pinned to 2026-10-08 (Pakistan).
 */
const C = coach as any;
const R = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id, teacherName: `T ${id}`, teacherPhone: null, teacherExtId: null, schoolName: "IMSG I-10/1", schoolExtId: null,
  status: "x", step: "sent", score: null, portal: true, createdAt, ...extra,
});
const ROWS = [
  R("a", "2026-10-06T06:00:00Z", { score: 80 }),
  R("b", "2026-10-05T06:00:00Z", { score: 60 }),
  R("c", "2026-10-04T06:00:00Z", { step: "draft" }),
  R("old", "2026-09-06T06:00:00Z", { score: 50 }),
];
const page = (items: any[], total: number, pageNo = 1) => ({
  success: true, waiting: [R("w", "2026-10-07T06:00:00Z", { step: "draft" }), R("w2", "2026-10-07T07:00:00Z", { step: "talk" })], inProgress: [],
  all: { total, page: pageNo, pageSize: 30, items },
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/coach/reports/all"]}>
      <Routes><Route path="/portal/coach/reports/all" element={<CoachReportsAll />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T07:00:00Z") });
  resetPendingCache();
  C.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
  C.getReports.mockResolvedValue(page(ROWS, 4));
});
afterEach(() => { vi.useRealTimers(); });

describe("All Observations", () => {
  it("this month by default; four numbers from the rows, with the change against last month", async () => {
    renderPage();
    const kpi = await screen.findByRole("group", { name: /Observations/ });
    expect(kpi).toBeInTheDocument();
    const text = document.body.textContent || "";
    expect(text).toContain("Avg. HITL Score");
    expect(screen.getByRole("group", { name: /^3 Observations/ })).toBeInTheDocument(); // 3 in October, up 2 on September's 1
    expect(screen.getByRole("group", { name: /70% Avg\. HITL Score/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^2 Waiting for you/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^2 Sent/ })).toBeInTheDocument();
  });

  it("the list holds only the range, by Pakistan day, percentages on rows; search sits under the range", async () => {
    renderPage();
    await screen.findByText("T a");
    expect(screen.queryByText("T old")).toBeNull(); // September is outside this month
    for (const day of ["Tue 6 Oct", "Mon 5 Oct", "Sun 4 Oct"]) expect(screen.getByRole("region", { name: day })).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    const search = screen.getByPlaceholderText("Name or phone");
    const bar = screen.getByRole("button", { name: /This month/ });
    expect(bar.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("search asks the server with the words, from page one", async () => {
    renderPage();
    await screen.findByText("T a");
    fireEvent.change(screen.getByPlaceholderText("Name or phone"), { target: { value: "hina" } });
    await waitFor(() => expect(C.getReports).toHaveBeenLastCalledWith(expect.objectContaining({ q: "hina", page: 1 })));
  });

  it("keeps asking for pages until the period before is covered", async () => {
    C.getReports
      .mockResolvedValueOnce(page([R("a", "2026-10-06T06:00:00Z", { score: 80 })], 3, 1))
      .mockResolvedValueOnce(page([R("b", "2026-09-20T06:00:00Z", { score: 60 })], 3, 2))
      .mockResolvedValueOnce(page([R("z", "2026-07-01T06:00:00Z", { score: 10 })], 3, 3));
    renderPage();
    await screen.findByText("T a");
    await waitFor(() => expect(C.getReports).toHaveBeenCalledTimes(3));
    expect(C.getReports).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
  });

  it("a failed read says so with Try again, never a shorter list", async () => {
    C.getReports.mockRejectedValueOnce(new Error("down"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "Try again" });
    C.getReports.mockResolvedValue(page(ROWS, 4));
    fireEvent.click(retry);
    expect(await screen.findByText("T a")).toBeInTheDocument();
  });

  it("nothing in the range says so", async () => {
    C.getReports.mockResolvedValue(page([R("old", "2026-01-06T06:00:00Z")], 1));
    renderPage();
    expect(await screen.findByText("None in these dates")).toBeInTheDocument();
    expect(within(document.body).queryAllByRole("region", { name: /Oct/ })).toHaveLength(0);
  });
});
