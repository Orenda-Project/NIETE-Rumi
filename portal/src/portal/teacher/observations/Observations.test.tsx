import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.4 — the teacher v2 Observations page (v28 canvas Observations) and its report.
 *
 *   Next visit    her own next coach visit (GET /teacher/visits): the day, the slot, the coach, the school
 *   In progress   a visit the coach is still working on: its stage only (no draft content)
 *   Reports       the coach visits sent to her (GET /coaching-sessions, observation only), each opening the
 *                 shared report page — never her own Digital Coach lessons
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
const portal = vi.hoisted(() => ({ getCoachingSessions: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));

import "../routes";
import api from "../../services/api";
import { ObservationsHomePage } from "./ObservationsHome";
import observationRoutes from "./routes";
import { OBS_HOME, OBS_REPORT, obsReportPath } from "./paths";
import { OBSERVATIONS_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

let visits: unknown;
beforeEach(() => {
  vi.clearAllMocks();
  visits = { success: true,
    next: { date: "2026-10-12", slot: "Morning", coachName: "Hataf Atif", schoolName: "IMSG I-10/1" },
    inProgress: [{ sessionId: "v1", date: "2026-10-07", coachName: "Hataf Atif", stage: "debrief" }] };
  http.get.mockImplementation(async (url: string) => {
    if (url === "/teacher/visits") return { data: visits };
    throw new Error(`unexpected GET ${url}`);
  });
  portal.getCoachingSessions.mockResolvedValue({
    sessions: [
      { id: "dc1", date: "2026-10-06T05:00:00Z", duration: 1800, overallScore: 30, maxScore: 52, percentage: 58, topic: "My own lesson", subject: "Science", observation: null },
      { id: "o1", date: "2026-09-28T05:00:00Z", duration: 1900, overallScore: 33, maxScore: 52, percentage: 63, topic: "Fractions", subject: "Mathematics",
        observation: { observerName: "Hataf Atif", observedAt: "2026-09-28T05:00:00Z", sentAt: "2026-09-30T05:00:00Z" } },
    ],
    pagination: { total: 2, page: 1, limit: 50, totalPages: 1 },
  });
});

const open = () => render(
  <MemoryRouter initialEntries={[OBS_HOME]}><Routes><Route path={OBS_HOME} element={<ObservationsHomePage />} /></Routes></MemoryRouter>,
);

describe("Observations", () => {
  it("her next visit: day, slot, coach, school", async () => {
    open();
    const next = await screen.findByRole("region", { name: C.nextVisit });
    expect(within(next).getByText(/Hataf Atif/)).toBeTruthy();
    expect(within(next).getByText(/IMSG I-10\/1/)).toBeTruthy();
    expect(within(next).getByText(/Morning/)).toBeTruthy();
  });

  it("no visit planned: said so", async () => {
    visits = { success: true, next: null, inProgress: [] };
    open();
    expect(await screen.findByText(C.noVisit)).toBeTruthy();
  });

  it("a visit being worked on shows its stage, not a link", async () => {
    open();
    const row = await screen.findByText(C.stages.debrief);
    expect(row.closest("a")).toBeNull();
  });

  it("Reports: the coach visits only, each to the shared report page; a band, never a number", async () => {
    open();
    const link = await screen.findByRole("link", { name: /Fractions/ });
    expect(link.getAttribute("href")).toBe(obsReportPath("o1"));
    expect(screen.queryByText("My own lesson")).toBeNull();
    expect(screen.getByText("Good")).toBeTruthy();
    expect(screen.queryByText("63%")).toBeNull();
  });

  it("registers the main page and the report", () => {
    const paths = observationRoutes.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining([OBS_HOME, OBS_REPORT]));
  });
});
