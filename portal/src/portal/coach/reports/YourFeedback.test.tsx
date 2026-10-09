import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getPending: vi.fn() }, leader: { getObservation: vi.fn() } }));
import { leader } from "../../services/api";
import YourFeedback from "./YourFeedback";

/**
 * bd-4404s7.5 — Your feedback (Blueprint Coach_Feedback): what the Digital Coach says about HER debrief, from the
 * observation view (talk.feedback). Real fields only: the praise line, her wins with their evidence, the one move to
 * try, the question to ask herself, or the one concern when the talk was harmful.
 */
const L = leader as any;
const FEEDBACK = {
  harmful: false, praise_line: "You listened well.",
  wins: [{ behaviour: "Asked Ayesha to name her next step", evidence: "What will you try tomorrow?" }],
  try: { move: "Give one concrete example", evidence: "The growth area stayed general", instead: "Point to the three-minute transition" },
  reflection_question: "What did she say she would try?", concern: null,
};
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: "2026-10-06T09:00:00Z", feedback: FEEDBACK },
  report: { status: null, teacherName: null, teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/feedback"]}>
    <Routes><Route path="/portal/coach/observation/:id/feedback" element={<YourFeedback />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { vi.clearAllMocks(); L.getObservation.mockResolvedValue(VIEW("feedback")); });

describe("Your feedback", () => {
  it("titled Your feedback, with the teacher and Step 4 of 5 in the crumb", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Your feedback");
    expect(screen.getByTestId("page-crumb")).toHaveTextContent("Ayesha Bibi · Step 4 of 5");
  });

  it("shows what she did well, what to try next time, and the question to ask herself", async () => {
    renderPage();
    const well = within(await screen.findByTestId("feedback-well"));
    expect(well.getByText("You did well")).toBeInTheDocument();
    expect(well.getByText("You listened well.")).toBeInTheDocument();
    expect(well.getByText("Asked Ayesha to name her next step")).toBeInTheDocument();
    expect(well.getByText(/What will you try tomorrow/)).toBeInTheDocument();
    const next = within(screen.getByTestId("feedback-try"));
    expect(next.getByText("Try next time")).toBeInTheDocument();
    expect(next.getByText("Give one concrete example")).toBeInTheDocument();
    expect(next.getByText("Point to the three-minute transition")).toBeInTheDocument();
    expect(next.getByText(/What did she say she would try/)).toBeInTheDocument();
  });

  it("her turn (step feedback): the dock goes on to Send the report", async () => {
    renderPage();
    const dock = await screen.findByTestId("feedback-next");
    expect(dock).toHaveAttribute("href", "/portal/coach/observation/cs-1/send");
    expect(dock).toHaveTextContent("Next");
  });

  it("read back after it is sent: no dock", async () => {
    L.getObservation.mockResolvedValue(VIEW("sent"));
    renderPage();
    await screen.findByTestId("feedback-well");
    expect(screen.queryByTestId("feedback-next")).toBeNull();
  });

  it("a harmful talk shows the one concern instead of praise", async () => {
    L.getObservation.mockResolvedValue(VIEW("feedback", { talk: { guide: null, recordedAt: null, feedback: {
      harmful: true, praise_line: null, wins: [], try: null, reflection_question: null,
      concern: { what_happened: "You corrected her in front of the class", why_it_matters: "She stopped answering", instead: "Say it in private" },
    } } }));
    renderPage();
    const c = within(await screen.findByTestId("feedback-concern"));
    expect(c.getByText("You corrected her in front of the class")).toBeInTheDocument();
    expect(c.getByText("Say it in private")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-well")).toBeNull();
  });

  it("while the talk is still being listened to: says so, no content, no dock", async () => {
    L.getObservation.mockResolvedValue(VIEW("listening", { talk: { guide: null, recordedAt: "x", feedback: null } }));
    renderPage();
    expect(await screen.findByText("Feedback is being written")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-next")).toBeNull();
  });

  it("a failed read says so with Try again", async () => {
    L.getObservation.mockRejectedValueOnce(new Error("down"));
    renderPage();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
