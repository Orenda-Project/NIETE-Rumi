import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.4 — All DC observations (v28 canvas CoachingAll), from Recent DC Observations' See all:
 * DateRangeBar (This month), KpiTiles counted by the server (GET /teacher/coaching/history) against the
 * period before, and every lesson in the range by Pakistan day — each as a band, never a number.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: {} }));

import "../routes";
import api from "../../services/api";
import { CoachingAllPage } from "./CoachingAll";
import coachingRoutes from "./routes";
import { COACHING_ALL } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (url: string) => {
    if (url !== "/teacher/coaching/history") throw new Error(`unexpected GET ${url}`);
    return { data: {
      success: true, range: { key: "custom" }, previous: { from: "2026-09-01", to: "2026-09-08" },
      kpis: { sessions: { value: 3, previous: 1 }, minutes: { value: 95, previous: 25 }, reports: { value: 2, previous: 1 } },
      trend: { bucketDays: 1, points: [1, 0, 0, 0, 1, 0, 0, 1] },
      items: [
        { id: "s3", date: "2026-10-08", topic: "Parts of a plant", subject: "General Science", grade: 4, minutes: 34, percentage: null, reportReady: false },
        { id: "s2", date: "2026-10-06", topic: "How plants make food", subject: "General Science", grade: 4, minutes: 30, percentage: 71, reportReady: true },
        { id: "s1", date: "2026-10-02", topic: "Naming words", subject: "English", grade: 3, minutes: 31, percentage: 47, reportReady: true },
      ],
      total: 3, truncated: false,
    } };
  });
});

describe("All DC observations", () => {
  it("asks for the range's dates and the period before, shows the server's numbers and the latest band", async () => {
    render(<MemoryRouter initialEntries={[COACHING_ALL]}><Routes><Route path={COACHING_ALL} element={<CoachingAllPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByText("How plants make food")).toBeTruthy();
    const params = http.get.mock.calls[0][1].params;
    expect(params.range).toBe("custom");
    expect(params.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(params.prevFrom).toBeTruthy();

    expect(within(document.body).getByText(C.kpiSessions)).toBeTruthy();
    expect(within(document.body).getByText("95")).toBeTruthy();
    expect(within(document.body).getByText(C.kpiLatestBand)).toBeTruthy();
    // the latest SCORED lesson's band; never its number
    expect(screen.getAllByText("Good").length).toBeGreaterThan(0);
    expect(screen.queryByText("71")).toBeNull();
    expect(screen.queryByText("71%")).toBeNull();
    expect(screen.getByText(C.analysing)).toBeTruthy();
  });

  it("is registered under Digital Coaching", () => {
    expect(coachingRoutes.map((r) => r.path)).toContain(COACHING_ALL);
  });
});
