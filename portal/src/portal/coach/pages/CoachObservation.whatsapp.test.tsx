import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getObservation: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachObservation from "./CoachObservation";

/**
 * bd-15y1pc — operator: "view the observation you did on the bot on the portal".
 * Her own WhatsApp observation opens in full here — the form's answers, the
 * debrief guide, her feedback — and its steps still happen on WhatsApp.
 */
const C = coach as any;
const L = leader as any;

const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-wa", date: "2026-10-06T06:30:00Z", step: "sent", portal: false, mine: true, score: 61, dcScore: 64,
  summary: "Clear modelling.", teacher: { name: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1" },
  observer: { self: true, name: "Hataf Atif" }, sentAt: "2026-10-06T12:00:00Z", caption: "Your report",
  imageUrl: "https://signed.example/report.png", audioUrl: null, ...extra,
});
const VIEW = (step: string) => ({
  id: "cs-wa", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: false,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: {
    guide: { intro: "Start with a win.", steps: [] }, recordedAt: "2026-10-06T09:00:00Z",
    feedback: { harmful: false, praise_line: "You listened well.", wins: [], try: null, reflection_question: null, concern: null },
  },
  report: { status: "sent", teacherName: "Ayesha Bibi", teacherPhone: null, caption: "Your report", companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
});
const DRAFT = {
  saved: true, editable: false, scale: [{ id: "2", title: "2 · Proficient" }], fidelityScale: [],
  sections: [{ key: "hlp", letter: "C", title: "High-Leverage Practices", kind: "indicators", notes: [],
    indicators: [{ id: "C1", field: "C1", name: "Quality Questioning", rating: "2", evidence: "Asked why twice", improvement: "Wait longer" }] }],
};

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-wa"]}>
    <Routes><Route path="/portal/coach/observation/:id" element={<CoachObservation />} /></Routes>
  </MemoryRouter>,
);
const stepRows = () => screen.getAllByTestId("obs-step");

beforeEach(() => {
  vi.clearAllMocks();
  C.getObservation.mockResolvedValue(OBS());
  L.getObservation.mockResolvedValue(VIEW("done"));
  L.getObservationDraft.mockResolvedValue(DRAFT);
});

describe("bd-15y1pc — her own WhatsApp observation, in full", () => {
  it("completed: the form's answers, the debrief guide and her feedback all open — not only the summary and report", async () => {
    renderPage();
    await waitFor(() => expect(L.getObservation).toHaveBeenCalledWith("cs-wa"));
    await waitFor(() => expect(stepRows().map((r) => r.getAttribute("data-state"))).toEqual(["done", "done", "done", "done", "done"]));

    fireEvent.click(within(stepRows()[1]).getByRole("button"));
    expect(await screen.findByTestId("form-answers")).toHaveTextContent("Asked why twice");

    await waitFor(() => expect(within(stepRows()[2]).getByRole("button")).toBeInTheDocument());
    fireEvent.click(within(stepRows()[2]).getByRole("button"));
    expect(await screen.findByTestId("talk-guide")).toHaveTextContent("Start with a win.");

    fireEvent.click(within(stepRows()[3]).getByRole("button"));
    expect(await screen.findByTestId("coach-feedback")).toHaveTextContent("You listened well.");
    expect(screen.queryByTestId("obs-dock")).toBeNull();
  });

  it.each([
    ["draft", 1, "/portal/leader/observe/cs-wa/draft?from=coach"],
    ["talk", 2, "/portal/leader/observe/cs-wa/talk?from=coach"],
    ["report", 4, "/portal/leader/observe/cs-wa?from=coach"],
  ])("bd-gie5ep — in progress at %s: she can carry on here — the step is hers and the dock opens it", async (step, at, href) => {
    C.getObservation.mockResolvedValue(OBS({ step: step === "report" ? "report" : step, score: null, sentAt: null, caption: null, imageUrl: null }));
    L.getObservation.mockResolvedValue(VIEW(step));
    renderPage();
    await waitFor(() => expect(stepRows()[at]).toHaveAttribute("aria-current", "step"));
    expect(await screen.findByTestId("obs-dock")).toHaveAttribute("href", href);
    expect(screen.queryByText("On WhatsApp")).toBeNull();
  });

  it("in progress: what is already done still opens here", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "talk", score: null, sentAt: null, caption: null, imageUrl: null }));
    L.getObservation.mockResolvedValue(VIEW("talk"));
    renderPage();
    await waitFor(() => expect(stepRows()[2]).toHaveAttribute("aria-current", "step"));
    fireEvent.click(within(stepRows()[1]).getByRole("button"));
    expect(await screen.findByTestId("form-answers")).toHaveTextContent("Quality Questioning");
  });

  it("another coach's WhatsApp observation stays as it was: the row only, the pipeline view is not asked", async () => {
    C.getObservation.mockResolvedValue(OBS({ mine: false, observer: { self: false, name: "Imran S" } }));
    renderPage();
    await waitFor(() => expect(stepRows()[4]).toHaveAttribute("data-state", "done"));
    expect(L.getObservation).not.toHaveBeenCalled();
    expect(within(stepRows()[1]).queryByRole("button")).toBeNull();
  });

  it("a debrief done but no report out is the Send-report step, not every step ticked", async () => {
    C.getObservation.mockResolvedValue(OBS({ mine: false, step: "report", score: null, sentAt: null, caption: null, imageUrl: null }));
    renderPage();
    await waitFor(() => expect(stepRows()[4]).toHaveAttribute("aria-current", "step"));
    expect(stepRows().map((r) => r.getAttribute("data-state"))).toEqual(["done", "done", "done", "done", "now"]);
    expect(within(stepRows()[4]).getByText("On WhatsApp")).toBeInTheDocument();
  });
});
