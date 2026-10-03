import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.26 — one lesson's page in the new UI (/portal/coaching/session/:id; portal_new_ui +
 * self-observation, a teacher). Today's LessonPage, rebuilt from the kit:
 *
 *   on its way   a Hero for where it is (Analysing ~10 min, Making report ~1 min) and the three
 *                steps as rows; her question here, a box and Send; or "Answer on WhatsApp"
 *   the report   InnerBar (crumb Coaching, the topic); subject · day · minutes · band chips; then
 *                sections, each with ONE short heading: Digital Coach (her debrief), Try next
 *                time, Went well, Rubric (each part's band as a chip), Your recording; the long
 *                ones fold: Your reflection, All tips, What was said. The coach's words are
 *                content, not UI copy, and stay readable.
 *   a coach      his observation as WhatsApp delivered it, once it is sent: the picture, caption
 *                and text, who and when
 *   other lessons waiting for her answer: a Next question row, the oldest first
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }) }; });
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children, ownHeading }: { children: React.ReactNode; ownHeading?: boolean }) => (
    <div data-testid="layout" data-own-heading={String(Boolean(ownHeading))}>{children}</div>
  ),
}));
vi.mock("../../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getDashboard: vi.fn(),
    getCoachingSession: vi.fn(),
    getCoachingProgress: vi.fn(),
    submitCoachingReflection: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
  },
}));
const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("../assessment/assessmentApi", async (orig) => ({
  ...(await orig<typeof import("../assessment/assessmentApi")>()),
  openFile: (url: string) => { opened.urls.push(url); },
}));

import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import { resetNewUiMemory } from "../../lib/useNewUi";
import PortalCoachingDetail from "../../pages/PortalCoachingDetail";

const api = portal as unknown as Record<string, ReturnType<typeof vi.fn>>;
const TEACHER = { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001" };

const progress = (stage: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", status: "x", stage, source: "portal", reflection: null, reportReady: stage === "done",
  shortRecording: false, hasLessonPlan: true, photoCount: 0, createdAt: "2026-10-02T05:02:00Z", ...extra,
});

const TRANSCRIPT = Array.from({ length: 8 }, (_, i) => `[00:${String(10 + i)}] ${i % 2 ? "Student" : "Teacher"} (UR): line ${i + 1}`).join("\n\n");

const DETAIL = {
  id: "cs-1", date: "2026-10-02T05:02:00Z", duration: 1680, status: "completed",
  overallScore: 30, maxScore: 44, percentage: 68, framework: "fico", topic: "Provinces of Pakistan", subject: "Social Studies",
  debriefAudioUrl: "https://r2/debrief.mp3", lessonAudioUrl: "https://r2/lesson.webm",
  reportUrl: "https://r2/report.png", reportFormat: "png",
  transcript: TRANSCRIPT,
  breakdown: { framework: "fico", language: "en", overall: 68, marks: 30, max: 44, groups: [
    { key: "a", domainKey: "a", name: "Children taking part", score: 9, max: 10, pct: 90, indicators: [] },
    { key: "b", domainKey: "b", name: "Teaching moves", score: 3, max: 10, pct: 30, indicators: [] },
  ] },
  reflection: [{ question: "Which question made the children think most?", answer: "The map question", language: "en", asked_at: null, answered_at: null }],
  prioritizedAction: { action: "Ask a child to point on the map before you explain." },
  analysisData: {
    overall_score: { points: 30, max_points: 44, percentage: 68 },
    strengths: ["You used the map to start the lesson.", "Children answered in pairs.", "Clear voice.", "A fourth strength."],
    growth_opportunities: ["More children could answer."],
    recommendations: ["Ask a child to point on the map before you explain.", "Use names when you ask."],
  },
};

function Where() {
  const { pathname, state } = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(state ?? null)}>{pathname}</output>;
}

function renderAt(id = "cs-1") {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[`/portal/coaching/session/${id}`]}>
      <Routes>
        <Route path="/portal/coaching/session/:sessionId" element={<PortalCoachingDetail />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const bar = () => screen.getByTestId("newui-inner-bar");
const chipText = (el: HTMLElement) => [...el.querySelectorAll("[data-chip]")].map((c) => c.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  opened.urls = [];
  resetNewUiMemory();
  api.getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, selfObservation: true, newUi: true } });
  api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
  api.getCoachingSession.mockResolvedValue({ session: DETAIL });
  api.getCoachingProgress.mockResolvedValue(progress("done"));
});

describe("which lesson page she gets", () => {
  it("the new UI: an inner page under Coaching", async () => {
    renderAt();
    expect(await screen.findByTestId("lesson-report")).toBeInTheDocument();
    expect(within(bar()).getByTestId("newui-crumb")).toHaveTextContent("Coaching");
    expect(screen.getByTestId("layout")).toHaveAttribute("data-own-heading", "true");
  });

  it("without the new UI: today's LessonPage", async () => {
    api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: true, newUi: false } });
    renderAt();
    expect(await screen.findByText("Try this next time")).toBeInTheDocument();
    expect(screen.queryByTestId("newui-inner-bar")).toBeNull();
  });
});

describe("on its way", () => {
  it("analysing: the three steps, the first one turning with ~10 min, the others to come", async () => {
    api.getCoachingProgress.mockResolvedValue(progress("transcribing"));
    renderAt();
    const steps = await screen.findByTestId("lesson-steps");
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Analysing"), expect.stringContaining("Your question"), expect.stringContaining("Report"),
    ]);
    const work = screen.getByTestId("lesson-step-work");
    expect(chipText(work)).toEqual(["~10 min"]);
    expect(within(work).getByTestId("newui-row-tile").querySelector("svg")!.getAttribute("class")).toMatch(/motion-safe:animate-spin/);
    expect(screen.getAllByTestId("lesson-step-todo")).toHaveLength(2);
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Your lesson");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("her question, here: the question, a box, and Send once she has written something", async () => {
    api.getCoachingProgress.mockResolvedValueOnce(progress("reflection", { reflection: { questionNumber: 1, question: "What did you do next?" } }))
      .mockResolvedValue(progress("report"));
    api.submitCoachingReflection.mockResolvedValue({ success: true });
    renderAt();
    expect(await screen.findByText("What did you do next?")).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Your answer" });
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.change(box, { target: { value: "I asked them to explain." } });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    await waitFor(() => expect(api.submitCoachingReflection).toHaveBeenCalledWith("cs-1", "I asked them to explain."));
    expect(await screen.findByText("Making report")).toBeInTheDocument();
  });

  it("an answer that did not send says so, and keeps what she wrote", async () => {
    api.getCoachingProgress.mockResolvedValue(progress("reflection", { reflection: { questionNumber: 1, question: "What did you do next?" } }));
    api.submitCoachingReflection.mockRejectedValue(new Error("down"));
    renderAt();
    const box = await screen.findByRole("textbox", { name: "Your answer" });
    fireEvent.change(box, { target: { value: "My answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByText("Not sent")).closest("[data-chip]")!.className).toMatch(/bg-nu-chip-error-bg/);
    expect(box).toHaveValue("My answer");
  });

  it("a question asked on WhatsApp is answered there", async () => {
    api.getCoachingProgress.mockResolvedValue(progress("reflection", { source: "whatsapp", reflection: { questionNumber: 1, question: "Q" } }));
    renderAt();
    expect(await screen.findByText("Answer on WhatsApp")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("could not be analysed: Not analysed, and Send again opens Coaching's sheet", async () => {
    api.getCoachingProgress.mockResolvedValue(progress("stopped"));
    renderAt();
    expect(await screen.findByText("Not analysed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    expect(await screen.findByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ sendSheet: true }));
  });

  it("not found", async () => {
    api.getCoachingProgress.mockRejectedValue({ response: { status: 404 } });
    renderAt();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });

  it("another lesson waiting for her answer: Next question, the oldest", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [
      { id: "a-2", createdAt: "2026-10-02T06:00:00Z", stage: "reflection", source: "portal", needsAnswer: true },
      { id: "a-1", createdAt: "2026-10-01T06:00:00Z", stage: "reflection", source: "portal", needsAnswer: true },
      { id: "cs-1", createdAt: "2026-09-01T06:00:00Z", stage: "reflection", source: "portal", needsAnswer: true },
    ] });
    renderAt();
    const row = await screen.findByTestId("lesson-next-question");
    expect(row).toHaveAttribute("href", "/portal/coaching/session/a-1");
    expect(row).toHaveTextContent("Next question");
    expect(chipText(row)).toEqual(["2 waiting"]);
  });
});

describe("the report", () => {
  it("the topic is the title; subject, day, minutes and the band as chips", async () => {
    renderAt();
    await screen.findByTestId("lesson-report");
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Provinces of Pakistan");
    const head = screen.getByTestId("lesson-chips");
    expect(chipText(head)).toEqual(["Social Studies", "2 Oct", "28 min", "Good"]);
    expect(within(head).getByText("Good").closest("[data-chip]")!.className).toMatch(/bg-nu-chip-done-bg/);
  });

  it("every section has one short heading (a label, never a sentence)", async () => {
    renderAt();
    const report = await screen.findByTestId("lesson-report");
    const headings = within(report).getAllByRole("heading").map((h) => h.textContent || "");
    expect(headings).toEqual(["Digital Coach", "Try next time", "Went well", "Rubric", "Your recording"]);
    for (const h of headings) expect(copyProblem(h)).toBeNull();
    const folds = within(report).getAllByRole("button", { expanded: false }).map((b) => b.textContent);
    expect(folds).toEqual(["Your reflection", "All tips", "What was said"]);
  });

  it("her debrief and her class recording play here", async () => {
    renderAt();
    const report = await screen.findByTestId("lesson-report");
    const sources = [...report.querySelectorAll("audio")].map((a) => a.getAttribute("src"));
    expect(sources).toEqual(["https://r2/debrief.mp3", "https://r2/lesson.webm"]);
  });

  it("the coach's words are content: the action, and three strengths", async () => {
    renderAt();
    const report = await screen.findByTestId("lesson-report");
    expect(within(report).getByRole("region", { name: "Try next time" })).toHaveTextContent("Ask a child to point on the map before you explain.");
    expect(within(within(report).getByRole("region", { name: "Went well" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("the rubric: each part with its band, in its meaning colour", async () => {
    renderAt();
    const rubric = within(await screen.findByTestId("lesson-report")).getByRole("region", { name: "Rubric" });
    const rows = within(rubric).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Children taking part"), expect.stringContaining("Teaching moves")]);
    expect(within(rows[0]).getByText("Excellent").closest("[data-chip]")!.className).toMatch(/bg-nu-chip-done-bg/);
    expect(within(rows[1]).getByText("Below average").closest("[data-chip]")!.className).toMatch(/bg-nu-chip-warning-bg/);
  });

  it("the long sections fold: her reflection, all tips, and what was said (six lines, then Show all)", async () => {
    renderAt();
    await screen.findByTestId("lesson-report");
    fireEvent.click(screen.getByRole("button", { name: "Your reflection" }));
    expect(screen.getByText("Which question made the children think most?")).toBeInTheDocument();
    expect(screen.getByText("The map question")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All tips" }));
    expect(screen.getByText("Use names when you ask.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What was said" }));
    expect(screen.getAllByTestId("transcript-line")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getAllByTestId("transcript-line")).toHaveLength(8);
  });

  it("the report picture opens as a file", async () => {
    renderAt();
    await screen.findByTestId("lesson-report");
    fireEvent.click(screen.getByRole("button", { name: "Report picture" }));
    expect(opened.urls).toEqual(["https://r2/report.png"]);
  });

  it("every target is 56px, folds open", async () => {
    renderAt();
    await screen.findByTestId("lesson-report");
    for (const name of ["Your reflection", "All tips", "What was said"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(tapProblems(document.body)).toEqual([]);
  });
});

describe("a coach's observation, once he has sent it", () => {
  beforeEach(() => {
    api.getCoachingSession.mockResolvedValue({ session: {
      ...DETAIL, topic: "Fractions",
      observation: { observerName: "Noor", observedAt: "2026-10-01T05:00:00Z", sentAt: "2026-10-01T09:00:00Z", reportImageUrl: "https://r2/obs.png", caption: "Well done", companionText: "Try names next time." },
    } });
  });

  it("shows it as WhatsApp delivered it: the picture, the caption and the text, who and when", async () => {
    renderAt();
    const obs = await screen.findByTestId("observation-report");
    expect(within(bar()).getByRole("heading", { level: 1 })).toHaveTextContent("Fractions");
    expect(chipText(screen.getByTestId("lesson-chips"))).toEqual(["Coach visit", "Noor", "1 Oct", "Sent"]);
    expect(within(obs).getByRole("img")).toHaveAttribute("src", "https://r2/obs.png");
    expect(within(obs).getByText("Well done")).toBeInTheDocument();
    expect(within(obs).getByText("Try names next time.")).toBeInTheDocument();
  });
});
