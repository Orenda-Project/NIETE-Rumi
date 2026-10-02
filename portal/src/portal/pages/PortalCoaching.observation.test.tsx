import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v.6.4 — a coach's observation, in the TEACHER's portal, once the coach
// has sent it to her (the API serves nothing earlier). Her Coaching list names
// who observed her; the lesson page is the report as WhatsApp delivered it —
// the image, its caption, the companion text — with who observed her and when.

vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }) }; });
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getCoachingSessions: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
    getCoachingSession: vi.fn(),
    getCoachingProgress: vi.fn(),
    submitCoachingReflection: vi.fn(),
  },
}));

import { portal } from "../services/api";
import PortalCoaching from "./PortalCoaching";
import PortalCoachingDetail from "./PortalCoachingDetail";

const api = portal as any;
const OBS = { observerName: "Sana Malik", observedAt: "2026-10-02T04:30:00Z", sentAt: "2026-10-02T10:24:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  api.getConfig.mockResolvedValue({ features: { selfObservation: true } });
  api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
});

describe("her Coaching list", () => {
  it("a coach's observation says who observed her", async () => {
    api.getCoachingSessions.mockResolvedValue({ sessions: [
      { id: "obs-1", date: OBS.observedAt, duration: 1800, overallScore: 30, maxScore: 44, percentage: 68, topic: "Fractions", subject: "Maths", observation: OBS },
      { id: "own-1", date: "2026-09-30T04:30:00Z", duration: 1800, overallScore: 30, maxScore: 44, percentage: 68, topic: "Her own lesson", subject: "Maths", observation: null },
    ] });
    render(<MemoryRouter><PortalCoaching /></MemoryRouter>);
    const list = await screen.findByTestId("recordings-list");
    const obsRow = within(list).getByText("Fractions").closest("a") as HTMLElement;
    expect(within(obsRow).getByText("Observed by Sana Malik")).toBeInTheDocument();
    const ownRow = within(list).getByText("Her own lesson").closest("a") as HTMLElement;
    expect(within(ownRow).queryByText(/Observed by/)).toBeNull();
  });
});

describe("the lesson page of a coach's observation", () => {
  const detail = {
    id: "obs-1", date: OBS.observedAt, duration: 1800, status: "completed",
    overallScore: 30, maxScore: 44, percentage: 68, topic: "Fractions", subject: "Maths",
    lessonAudioUrl: null, debriefAudioUrl: null, reportUrl: null, transcript: null, breakdown: null,
    reflection: [], prioritizedAction: null,
    analysisData: { overall_score: { points: 30, max_points: 44, percentage: 68 }, strengths: ["s"], growth_opportunities: [], recommendations: ["r"] },
    observation: {
      ...OBS,
      reportImageUrl: "https://r2/observe-reports/obs-1.png?signed=1",
      caption: "Your lesson report 🌱 Prepared from Sana’s visit",
      companionText: "📝 From Sana\n\nWe talked about pair work.",
    },
  };

  it("is the report as WhatsApp delivered it, with who observed her and when", async () => {
    api.getCoachingProgress.mockResolvedValue({ id: "obs-1", stage: "done", source: "whatsapp", reflection: null, createdAt: OBS.observedAt });
    api.getCoachingSession.mockResolvedValue({ session: detail });
    render(
      <MemoryRouter initialEntries={["/portal/coaching/session/obs-1"]}>
        <Routes><Route path="/portal/coaching/session/:sessionId" element={<PortalCoachingDetail />} /></Routes>
      </MemoryRouter>,
    );
    const img = await screen.findByAltText("Your observation report");
    expect(img.getAttribute("src")).toBe("https://r2/observe-reports/obs-1.png?signed=1");
    expect(screen.getByText("Your lesson report 🌱 Prepared from Sana’s visit")).toBeInTheDocument();
    expect(screen.getByText(/We talked about pair work/)).toBeInTheDocument();
    expect(screen.getByText(/Observed by Sana Malik/)).toBeInTheDocument();
    // Not her own recording's report: no question she answered, no "your reflection".
    expect(screen.queryByText("Question answered")).toBeNull();
    expect(screen.queryByText("Your reflection")).toBeNull();
  });
});
