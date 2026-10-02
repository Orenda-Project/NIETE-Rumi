import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v — one lesson page, always openable (teachers with
// portal_self_observation; everyone else keeps today's report page).
//
//   analysing   a 3-step tracker: Analysing your class (moving) → Your question → Your report
//   question    Analysis done ✓ → Answer your question (her question, a box, Send) → Your report
//   making      ✓ ✓ → Making your report
//   report      the report, and at the end what was said in class
//
// A banner on top walks her to the next lesson waiting for her answer.

// A STABLE toast, as the real hook returns: the pages re-fetch when it changes.
vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }) }; });
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getCoachingSession: vi.fn(),
    getCoachingProgress: vi.fn(),
    submitCoachingReflection: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
  },
}));

import { portal } from "../services/api";
import PortalCoachingDetail from "./PortalCoachingDetail";

const api = portal as any;

const progress = (stage: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", status: "x", stage, source: "portal", reflection: null, reportReady: stage === "done",
  shortRecording: false, hasLessonPlan: true, photoCount: 0, createdAt: "2026-10-02T05:02:00Z", ...extra,
});

const TRANSCRIPT = Array.from({ length: 8 }, (_, i) => `[00:${String(10 + i)}] ${i % 2 ? "Student" : "Teacher"} (UR): line ${i + 1}`).join("\n\n");

const detail = {
  id: "cs-1", date: "2026-10-02T05:02:00Z", duration: 1680, status: "completed",
  overallScore: 30, maxScore: 44, percentage: 68, framework: "fico", topic: "Provinces of Pakistan", subject: "Social Studies",
  debriefAudioUrl: "https://r2/debrief.mp3", lessonAudioUrl: "https://r2/lesson.webm",
  reportUrl: "https://r2/report.png", reportFormat: "png",
  transcript: TRANSCRIPT,
  breakdown: { framework: "fico", language: "en", overall: 68, marks: 30, max: 44, groups: [
    { key: "a", domainKey: "a", name: "Children taking part", score: 9, max: 10, pct: 90, indicators: [] },
    { key: "b", domainKey: "b", name: "Teaching moves", score: 6, max: 10, pct: 60, indicators: [] },
  ] },
  reflection: [{ question: "Which question made the children think most?", answer: "The map question", language: "en", asked_at: null, answered_at: null }],
  prioritizedAction: { action: "Ask a child to point on the map before you explain." },
  analysisData: {
    overall_score: { points: 30, max_points: 44, percentage: 68 },
    strengths: ["You used the map to start the lesson."],
    growth_opportunities: ["More children could answer."],
    recommendations: ["Ask a child to point on the map before you explain.", "Use names when you ask."],
  },
};

function renderAt(id = "cs-1") {
  return render(
    <MemoryRouter initialEntries={[`/portal/coaching/session/${id}`]}>
      <Routes>
        <Route path="/portal/coaching/session/:sessionId" element={<PortalCoachingDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getConfig.mockResolvedValue({ features: { selfObservation: true } });
  api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
  api.getCoachingSession.mockResolvedValue({ session: detail });
  api.getCoachingProgress.mockResolvedValue(progress("done"));
});

describe("the lesson page — dark until the feature is on", () => {
  it("is today's report page for a teacher without the feature", async () => {
    api.getConfig.mockResolvedValue({ features: { selfObservation: false } });
    renderAt();
    await waitFor(() => expect(api.getCoachingSession).toHaveBeenCalledWith("cs-1"));
    expect(api.getCoachingProgress).not.toHaveBeenCalled();
    expect(screen.queryByTestId("lesson-tracker")).not.toBeInTheDocument();
  });
});

describe("the lesson page — while it is being analysed", () => {
  it("shows the three steps, with only the first one moving", async () => {
    api.getCoachingProgress.mockResolvedValue(progress("transcribing"));
    renderAt();
    const tracker = await screen.findByTestId("lesson-tracker");
    expect(within(tracker).getByText("Analysing your class")).toBeInTheDocument();
    expect(within(tracker).getByText(/about 10 minutes/i)).toBeInTheDocument();
    expect(within(tracker).getByText("Your question")).toBeInTheDocument();
    expect(within(tracker).getByText("Your report")).toBeInTheDocument();
    expect(within(tracker).getAllByTestId("step-work")).toHaveLength(1);
    expect(within(tracker).getAllByTestId("step-todo")).toHaveLength(2);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("the lesson page — her question", () => {
  beforeEach(() => {
    api.getCoachingProgress.mockResolvedValue(progress("reflection", {
      reflection: { questionNumber: 1, question: "When two children said the parts were different sizes, what did you do next?" },
    }));
  });

  it("puts her question in front of her, with a box and Send", async () => {
    renderAt();
    expect(await screen.findByText(/what did you do next\?/)).toBeInTheDocument();
    const tracker = screen.getByTestId("lesson-tracker");
    expect(within(tracker).getByText("Analysis done")).toBeInTheDocument();
    expect(within(tracker).getByText("Answer your question")).toBeInTheDocument();
    expect(within(tracker).getAllByTestId("step-done")).toHaveLength(1);
    expect(within(tracker).getAllByTestId("step-you")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("sends her answer, then says the report is being made", async () => {
    api.submitCoachingReflection.mockResolvedValue({ done: true, acknowledgement: "Thank you." });
    renderAt();
    fireEvent.change(await screen.findByRole("textbox", { name: /your answer/i }), { target: { value: "I folded it again" } });
    api.getCoachingProgress.mockResolvedValue(progress("report"));
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(api.submitCoachingReflection).toHaveBeenCalledWith("cs-1", "I folded it again"));
    const tracker = await screen.findByTestId("lesson-tracker");
    expect(await within(tracker).findByText("Question answered")).toBeInTheDocument();
    expect(within(tracker).getByText("Making your report")).toBeInTheDocument();
  });

  it("a WhatsApp lesson's question is answered on WhatsApp, not here", async () => {
    api.getCoachingProgress.mockResolvedValue(progress("reflection", { source: "whatsapp", reflection: null }));
    renderAt();
    expect(await screen.findByText(/answer your question on whatsapp/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("the lesson page — the report", () => {
  it("leads with what to try next time and what went well, then the rest on request", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { name: "Provinces of Pakistan" })).toBeInTheDocument();
    expect(screen.queryByTestId("lesson-tracker")).not.toBeInTheDocument();
    expect(screen.getByText(/analysis done/i)).toBeInTheDocument();
    expect(screen.getByText(/report ready/i)).toBeInTheDocument();
    expect(screen.getByText("Listen to your Digital Coach")).toBeInTheDocument();
    expect(screen.getByText("Try this next time")).toBeInTheDocument();
    expect(screen.getByText(/point on the map before you explain/)).toBeInTheDocument();
    expect(screen.getByText("What went well")).toBeInTheDocument();
    expect(screen.getByText(/you used the map to start the lesson/i)).toBeInTheDocument();

    expect(screen.queryByText("Children taking part")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /see more/i }));
    expect(screen.getByText("Children taking part")).toBeInTheDocument();
    expect(screen.getAllByText("Excellent").length).toBeGreaterThan(0);
    expect(screen.getByText("Your class recording")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /report picture/i })).toHaveAttribute("href", "https://r2/report.png");
  });

  it("keeps her own reflection one tap away", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /your reflection/i }));
    expect(screen.getByText(/which question made the children think most/i)).toBeInTheDocument();
    expect(screen.getByText("The map question")).toBeInTheDocument();
  });

  it("ends with what was said in class: six lines, then all of them", async () => {
    renderAt();
    const section = await screen.findByTestId("transcript");
    expect(within(section).getByText("What was said in class")).toBeInTheDocument();
    expect(within(section).getAllByTestId("transcript-line")).toHaveLength(6);
    expect(within(section).getAllByText("Teacher").length).toBeGreaterThan(0);
    expect(within(section).getAllByText("Student").length).toBeGreaterThan(0);
    fireEvent.click(within(section).getByRole("button", { name: /show all/i }));
    expect(within(section).getAllByTestId("transcript-line")).toHaveLength(8);
  });
});

describe("the lesson page — the next lesson waiting for her", () => {
  it("names how many MORE wait, and Next opens the oldest of the others", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [
      { id: "older", createdAt: "2026-10-01T05:00:00Z", stage: "reflection", source: "portal", needsAnswer: true },
      { id: "cs-1", createdAt: "2026-10-02T05:00:00Z", stage: "reflection", source: "portal", needsAnswer: true },
      { id: "newer", createdAt: "2026-10-02T07:00:00Z", stage: "reflection", source: "portal", needsAnswer: true },
      { id: "busy", createdAt: "2026-10-02T08:00:00Z", stage: "analysing", source: "portal", needsAnswer: false },
    ] });
    renderAt();
    const banner = await screen.findByTestId("needs-answer-banner");
    expect(within(banner).getByText("2 more lessons need your answer")).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: /next/i })).toHaveAttribute("href", "/portal/coaching/session/older");
  });

  it("shows no banner when this was the only one", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [
      { id: "cs-1", createdAt: "2026-10-02T05:00:00Z", stage: "reflection", source: "portal", needsAnswer: true },
    ] });
    renderAt();
    await screen.findByRole("heading", { name: "Provinces of Pakistan" });
    expect(screen.queryByTestId("needs-answer-banner")).not.toBeInTheDocument();
  });
});

describe("the lesson page — when it could not be analysed", () => {
  it("says so plainly and offers to record again", async () => {
    api.getCoachingProgress.mockResolvedValue(progress("stopped"));
    renderAt();
    expect(await screen.findByText(/could not analyse this lesson/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /record again/i })).toHaveAttribute("href", "/portal/coaching/new");
  });
});
