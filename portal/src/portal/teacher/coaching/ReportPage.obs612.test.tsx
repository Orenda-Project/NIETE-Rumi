import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-pni007 — the teacher opens the report her coach sent after an FDE (obs612) visit: the report image as it reached
 * her, and FDE's own result under it. Never the FICO report body: no FICO sections, no score, no journey line (her
 * earlier FICO lessons drawn beside a visit scored on FDE's tool).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(),
  getCoachingSession: vi.fn(),
  submitCoachingReflection: vi.fn(),
  presignCoachingUpload: vi.fn(),
  uploadToR2: vi.fn(),
  submitCoachingVoiceReflection: vi.fn(),
  getCoachingReportFile: vi.fn(),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock("./navigate", () => ({ goTo: vi.fn() }));

import "../routes";
import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { ReportPage } from "./ReportPage";
import { COACHING_REPORT } from "./paths";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const FDE = {
  label: "FDE v1", rubric: "obs612-enur-v1", tool: "enur", toolName: "English & Urdu tool",
  toolTitle: "CLASSROOM OBSERVATION TOOL For English & Urdu Lessons (Grade VI-VIII)", grade: 7, subject: "English",
  result: "73.6% · Proficient", noTotal: false, headline: "109 / 148 · 73.6% · Proficient",
  rows: [{ name: "D. Interest & Motivation", value: "8/8", pct: 100 }],
  feedback: [{ label: "Strengths", text: "Clear objectives and a warm tone with every student." }],
  footer: "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score.",
};

const DETAIL = {
  id: ID, date: "2026-11-11T09:31:00Z", duration: null, overallScore: 0, maxScore: 0, percentage: null,
  topic: null, subject: null, lessonAudioUrl: null, debriefAudioUrl: null, reportUrl: null, photoUrls: [],
  breakdown: null, reflection: [], prioritizedAction: null, reportNarrative: null,
  analysisData: { overall_score: { points: 0, max_points: 0, percentage: null } },
  observation: { observerName: "Sana Malik", observedAt: "2026-11-11T09:31:00Z", sentAt: "2026-11-11T10:00:00Z",
    reportImageUrl: "https://r2/fde.png", caption: "Your FDE report", companionText: null },
  obs612: FDE,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetShareAvailability();
  http.get.mockImplementation(async (url: string) => {
    if (url === `/teacher/coaching/${ID}/journey`) return { data: { success: true, points: [{ date: "2026-09-10", pct: 50 }, { date: "2026-10-02", pct: 58 }] } };
    if (url === "/share/availability") return { data: { kinds: {} } };
    throw new Error(`unexpected GET ${url}`);
  });
  portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
  portal.getCoachingSession.mockResolvedValue({ session: DETAIL });
});

describe("the teacher's FDE report", () => {
  it("the image she received and FDE's own result; no FICO body, score or journey", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={[COACHING_REPORT.replace(":id", ID)]}>
        <Routes><Route path={COACHING_REPORT} element={<ReportPage />} /></Routes>
      </MemoryRouter>,
    );
    const block = within(await screen.findByTestId("obs612"));
    expect(block.getByTestId("obs612-headline")).toHaveTextContent("109 / 148 · 73.6% · Proficient");
    expect(block.getByTestId("obs612-label")).toHaveTextContent("FDE v1");
    expect(container.querySelector('img[src="https://r2/fde.png"]')).not.toBeNull();
    // ReportBody (FICO sections, the % and the journey line) is never drawn for it.
    expect(container.querySelector('svg[role="img"] polyline')).toBeNull();
    expect(screen.queryByTestId("report-score")).toBeNull();
    expect(screen.queryByTestId("score-bar")).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|0%|Lesson Plan Fidelity/);
  });
});
