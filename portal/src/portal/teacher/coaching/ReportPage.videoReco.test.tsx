import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-gzfdu9 (VIDREC, SPEC §4.7) — the report page with the recommended clip. The API's `video_recommendation` is
 * absent while VIDEO_RECO_ENABLED is off and null when there is no clip: either way the page is today's, node for
 * node. With a clip, its card sits right under "Try next class".
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(),
  getCoachingSession: vi.fn(),
  submitCoachingReflection: vi.fn(),
  getCoachingReportFile: vi.fn(),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock("./navigate", () => ({ goTo: vi.fn() }));

import "../routes";
import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { ReportPage } from "./ReportPage";
import { COACHING_REPORT } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const DETAIL = {
  id: ID, date: "2026-10-02T06:00:00Z", duration: 1680, overallScore: 30, maxScore: 52, percentage: 58,
  topic: "Provinces of Pakistan", subject: "Social Studies",
  debriefAudioUrl: "https://r2/debrief.mp3", reportUrl: "https://r2/report.png", photoUrls: [],
  breakdown: { framework: "fico", language: "en", overall: 58, marks: 30, max: 52, groups: [
    { key: "B", domainKey: "lp", name: "Lesson Plan Fidelity", score: 9, max: 14, pct: 64, indicators: [] },
  ] },
  reflection: [],
  prioritizedAction: { action: "Ask the back rows first.", commitment: null },
  analysisData: { overall_score: { points: 30, max_points: 52, percentage: 58 } },
  observation: null,
  reportNarrative: { headline: "A lesson the whole class joined", identity: "", moments: [], strength: null, horizon: null, domainWhys: {}, language: "en", journeyNote: null },
};

const VIDEO = {
  title: "Asking why-questions", levelLabel: null, durationS: 120, language: "ur",
  reason: "At 12:40 a question was answered at once; this clip shows the wait.",
  thumbUrl: "/v/thumb/3.jpg", href: "/v/tok-abc?s=portal",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetShareAvailability();
  http.get.mockImplementation(async (url: string) => {
    if (url === `/teacher/coaching/${ID}/journey`) return { data: { success: true, points: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
  portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "completed", stage: "done", reflection: null, reportReady: true });
});

async function openWith(session: Record<string, unknown>) {
  portal.getCoachingSession.mockResolvedValue({ session });
  const view = render(
    <MemoryRouter initialEntries={[COACHING_REPORT.replace(":id", ID)]}>
      <Routes><Route path={COACHING_REPORT} element={<ReportPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: C.fullReport });
  return view;
}

describe("ReportPage + the recommended clip", () => {
  it("no key (flag off) and null (no clip) draw exactly today's page", async () => {
    const today = (await openWith(DETAIL)).container.innerHTML;
    expect(screen.queryByRole("region", { name: C.videoRecoCardTitle })).toBeNull();
    const withNull = (await openWith({ ...DETAIL, video_recommendation: null })).container.innerHTML;
    expect(withNull).toBe(today);
  });

  it("a clip → its card right under 'Try next class', before the footer", async () => {
    await openWith({ ...DETAIL, video_recommendation: VIDEO });
    const card = screen.getByRole("region", { name: C.videoRecoCardTitle });
    const tryNext = screen.getByRole("region", { name: "Try next class" });
    expect(tryNext.nextElementSibling).toBe(card);
    expect(screen.getByRole("link", { name: "Watch (2 min)" }).getAttribute("href")).toBe("/v/tok-abc?s=portal");
  });

  it("a report shown as its WhatsApp image (no narrative) still gets the card, under the image", async () => {
    await openWith({ ...DETAIL, reportNarrative: null, video_recommendation: VIDEO });
    const img = screen.getByRole("img", { name: C.fullReport });
    const card = screen.getByRole("region", { name: C.videoRecoCardTitle });
    expect(img.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
