import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("./CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../services/api", () => ({ coach: { getPending: vi.fn(), getReports: vi.fn(), getVisit: vi.fn() }, leader: {} }));
import { coach } from "../services/api";
import { CoachPage, resetPendingCache } from "./ui";
import CoachReports from "./pages/CoachReports";
import CoachRecord from "./pages/CoachRecord";
import CoachAttach from "./pages/CoachAttach";
import CoachCheckSend from "./pages/CoachCheckSend";

/**
 * bd-o15qnr.21 — "There should be a banner at the top at all times showing if
 * there are reports pending on the coach" — every v2 page, above its header;
 * never over a recording.
 */
const C = coach as any;

function at(path: string, el: React.ReactNode, route = path.split("?")[0]) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPendingCache();
});

describe("the pending banner", () => {
  it("two waiting: amber, 56px+, '2 reports waiting', above the header, opens Reports filtered to waiting", async () => {
    C.getPending.mockResolvedValue({ success: true, waiting: 2, ids: ["a", "b"] });
    at("/portal/coach/x", <CoachPage title="Schedule" backTo="/portal/coach"><p>body</p></CoachPage>);
    const banner = await screen.findByTestId("pending-banner");
    expect(banner).toHaveTextContent("2 reports waiting");
    expect(banner).toHaveAttribute("href", "/portal/coach/reports?show=waiting");
    expect(banner.className).toMatch(/bg-\[#fef3c7\]/);
    expect(banner.className).toMatch(/text-\[#b45309\]/);
    expect(banner.className).toMatch(/min-h-\[56px\]/);
    const header = screen.getByRole("banner");
    expect(banner.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("one waiting opens that observation", async () => {
    C.getPending.mockResolvedValue({ success: true, waiting: 1, ids: ["a"] });
    at("/portal/coach/x", <CoachPage title="Home"><p>body</p></CoachPage>);
    const banner = await screen.findByTestId("pending-banner");
    expect(banner).toHaveTextContent("1 report waiting");
    expect(banner).toHaveAttribute("href", "/portal/coach/observation/a");
  });

  it("none waiting, or the read fails: no banner", async () => {
    C.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
    at("/portal/coach/x", <CoachPage title="Home"><p>body</p></CoachPage>);
    await waitFor(() => expect(C.getPending).toHaveBeenCalled());
    expect(screen.queryByTestId("pending-banner")).toBeNull();
    resetPendingCache();
    C.getPending.mockRejectedValue(new Error("down"));
    at("/portal/coach/y", <CoachPage title="Home"><p>body</p></CoachPage>);
    await waitFor(() => expect(C.getPending).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("pending-banner")).toBeNull();
  });

  it("read once and shared across pages", async () => {
    C.getPending.mockResolvedValue({ success: true, waiting: 2, ids: ["a", "b"] });
    const one = at("/portal/coach/x", <CoachPage title="A"><p>a</p></CoachPage>);
    await screen.findByTestId("pending-banner");
    one.unmount();
    at("/portal/coach/y", <CoachPage title="B"><p>b</p></CoachPage>);
    await screen.findByTestId("pending-banner");
    expect(C.getPending).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Record live", "/portal/coach/visit/v1/record", "/portal/coach/visit/:id/record", <CoachRecord />],
    ["Upload recording", "/portal/coach/visit/v1/attach", "/portal/coach/visit/:id/attach", <CoachAttach />],
    ["Check and send", "/portal/coach/visit/v1/check", "/portal/coach/visit/:id/check", <CoachCheckSend />],
  ])("never on %s", async (_n, path, route, el) => {
    C.getPending.mockResolvedValue({ success: true, waiting: 2, ids: ["a", "b"] });
    C.getVisit.mockResolvedValue({ success: true, teacher: null, lastVisit: null, visit: { id: "v1", teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "S", schoolExtId: "niete:110", scheduledFor: "2026-10-07", scheduledSlot: "11:30", status: "upcoming" } });
    at(path, el, route);
    await screen.findAllByText(/Ayesha Bibi/);
    expect(screen.queryByTestId("pending-banner")).toBeNull();
    expect(C.getPending).not.toHaveBeenCalled();
  });
});

describe("Reports filtered to waiting", () => {
  it("?show=waiting shows only Waiting for you, with a way back to all", async () => {
    C.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
    const R = (id: string, step: string) => ({ id, createdAt: "2026-10-05T09:00:00Z", teacherName: `T ${id}`, teacherPhone: null, teacherExtId: null, schoolName: "S", schoolExtId: null, status: "x", step, score: null, portal: true });
    C.getReports.mockResolvedValue({ success: true, waiting: [R("w1", "draft"), R("w2", "talk")], inProgress: [R("p1", "analysing")], all: { total: 1, page: 1, pageSize: 20, items: [R("s1", "sent")] } });
    at("/portal/coach/reports?show=waiting", <CoachReports />);
    expect(await screen.findByText("T w1")).toBeInTheDocument();
    expect(screen.getByText("T w2")).toBeInTheDocument();
    expect(screen.queryByText("T p1")).toBeNull();
    expect(screen.queryByText("T s1")).toBeNull();
    expect(screen.getByRole("link", { name: "All reports" })).toHaveAttribute("href", "/portal/coach/reports");
  });
});
