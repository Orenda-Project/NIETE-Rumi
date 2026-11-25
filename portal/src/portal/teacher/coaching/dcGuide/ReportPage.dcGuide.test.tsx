import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-ra8xu.64.3 (queue #282) — the "?" in the header of HER report page (ReportPage), opening the teacher's indicator
 * guide: on her own Digital Coach report scored on FICO17 v6 only. The session detail carries the stored rubric's LABEL
 * (dashboard portal.routes.js → rubric-label.js rubricLabelText: "FICO17 v6", "FICO17 v6.1", "FICO V3"), and a coach's
 * visit carries `observation`. No "?" on a V3 report, on a coach visit's report, or while the report loads.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(),
  getCoachingSession: vi.fn(),
  submitCoachingReflection: vi.fn(),
  getCoachingReportFile: vi.fn(),
}));
vi.mock("../../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));

import "../../routes";
import api from "../../../services/api";
import { resetShareAvailability } from "../../share/api";
import { ReportPage } from "../ReportPage";
import { COACHING_REPORT } from "../paths";
import { COACHING_V2_COPY as C } from "../copy";
import { DC_GUIDE_COPY as E } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const DETAIL = {
  id: ID, date: "2026-11-25T06:00:00Z", duration: 1680, overallScore: 20, maxScore: 44, percentage: 45,
  topic: "Adding within 10", subject: "Mathematics", rubric: "FICO17 v6",
  lessonAudioUrl: "https://r2/lesson.webm", debriefAudioUrl: null, reportUrl: "https://r2/report.png", photoUrls: [],
  breakdown: { framework: "fico17_v6", language: "en", overall: 45, marks: 20, max: 44, groups: [
    { key: "C", domainKey: "c", name: "What the teacher does", score: 10, max: 20, pct: 50, indicators: [] },
  ] },
  reflection: [], prioritizedAction: null,
  analysisData: { overall_score: { points: 20, max_points: 44, percentage: 45 } },
  observation: null,
  reportNarrative: { headline: "Children explained their sums", identity: "", moments: [], strength: null, horizon: null, domainWhys: {}, language: "en", journeyNote: null },
};
const VISIT = { observerName: "Sample Coach", observedAt: DETAIL.date, sentAt: null, reportImageUrl: "https://r2/visit.png", caption: null, companionText: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetShareAvailability();
  http.get.mockImplementation(async (url: string) => {
    if (url === `/teacher/coaching/${ID}/journey`) return { data: { success: true, points: [] } };
    if (url === "/share/availability") return { data: { kinds: {} } };
    throw new Error(`unexpected GET ${url}`);
  });
});

const open = () => render(
  <MemoryRouter initialEntries={[COACHING_REPORT.replace(":id", ID)]}>
    <Routes><Route path={COACHING_REPORT} element={<ReportPage />} /></Routes>
  </MemoryRouter>,
);

const ready = (session: object) => {
  portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
  portal.getCoachingSession.mockResolvedValue({ session });
};

describe("the '?' on her report page", () => {
  it("her own DC report on FICO17 v6: a '?' at the end of the header, after Download; it opens her guide", async () => {
    ready(DETAIL);
    open();
    const q = await screen.findByTestId("dc-guide-button");
    const header = q.closest("header")!;
    expect(header).toBeTruthy();
    const download = within(header).getByRole("button", { name: C.download });
    expect(download.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(q);
    const tray = await screen.findByTestId("dc-guide-tray");
    expect(within(tray).getByRole("heading", { level: 2 }).textContent).toBe(E.heading);
    expect((await within(tray).findAllByTestId("dc-guide-card")).length).toBe(11);
  });

  // Queue #282 prod smoke (25 Nov): with Download AND the "?" side by side, the title had ~150 px at 360 px and
  // "Patterns and Sequences" broke mid-word. The two buttons stack in one column, so the title keeps today's width.
  it("Download and the '?' stack in one column, so the title keeps its width at phone size", async () => {
    ready(DETAIL);
    open();
    const q = await screen.findByTestId("dc-guide-button");
    const header = q.closest("header")!;
    const download = within(header).getByRole("button", { name: C.download });
    const column = q.closest('[data-testid="report-actions"]') as HTMLElement | null;
    expect(column).not.toBeNull();
    expect(column!.contains(download)).toBe(true);
    expect(column!.className).toMatch(/\bflex-col\b/);
  });

  it("FICO17 v6.1 (a minor version) too", async () => {
    ready({ ...DETAIL, rubric: "FICO17 v6.1" });
    open();
    expect(await screen.findByTestId("dc-guide-button")).toBeTruthy();
  });

  it("a V3 report: no '?'", async () => {
    ready({ ...DETAIL, rubric: "FICO V3" });
    open();
    expect(await screen.findByRole("heading", { name: C.fullReport })).toBeTruthy();
    expect(screen.queryByTestId("dc-guide-button")).toBeNull();
  });

  it("a report with no rubric stored: no '?'", async () => {
    ready({ ...DETAIL, rubric: null });
    open();
    expect(await screen.findByRole("heading", { name: C.fullReport })).toBeTruthy();
    expect(screen.queryByTestId("dc-guide-button")).toBeNull();
  });

  it("a coach's visit report (even one scored on FICO17 v6): no '?' — it is not her own recording", async () => {
    ready({ ...DETAIL, observation: VISIT });
    open();
    expect(await screen.findByRole("heading", { name: C.yourRecording })).toBeTruthy();
    expect(screen.queryByTestId("dc-guide-button")).toBeNull();
  });

  it("while the report loads: no '?'", async () => {
    portal.getCoachingProgress.mockReturnValue(new Promise(() => {}));
    open();
    expect(await screen.findByText(C.loading)).toBeTruthy();
    expect(screen.queryByTestId("dc-guide-button")).toBeNull();
  });

  it("while the report is still being made (no session read yet): no '?'", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "analyzing", stage: "analysing", reflection: null });
    portal.getCoachingSession.mockReturnValue(new Promise(() => {}));
    open();
    expect(await screen.findByRole("region", { name: C.progress })).toBeTruthy();
    expect(screen.queryByTestId("dc-guide-button")).toBeNull();
  });
});
