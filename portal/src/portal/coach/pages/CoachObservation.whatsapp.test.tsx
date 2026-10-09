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
const stepsRegion = () => within(screen.getByRole("region", { name: "Steps" }));
const current = () => stepsRegion().getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step");

beforeEach(() => {
  vi.clearAllMocks();
  C.getObservation.mockResolvedValue(OBS());
  L.getObservation.mockResolvedValue(VIEW("done"));
  L.getObservationDraft.mockResolvedValue(DRAFT);
});

describe("bd-15y1pc — her own WhatsApp observation, in full", () => {
  it("completed: What you made opens the form's answers, the debrief guide and her feedback — from either side", async () => {
    renderPage();
    await waitFor(() => expect(L.getObservation).toHaveBeenCalledWith("cs-wa"));
    const made = within(await screen.findByTestId("what-you-made"));
    await waitFor(() => expect(made.getAllByRole("link")).toHaveLength(3));
    expect(made.getByRole("link", { name: /Feedback Form/ })).toHaveAttribute("href", "/portal/coach/observation/cs-wa/form");
    expect(made.getByRole("link", { name: /Debrief/ })).toHaveAttribute("href", "/portal/coach/observation/cs-wa/debrief");
    expect(made.getByRole("link", { name: /Your feedback/ })).toHaveAttribute("href", "/portal/coach/observation/cs-wa/feedback");
    expect(screen.queryByTestId("obs-dock")).toBeNull();
  });

  it.each([
    ["draft", "Feedback Form", "/portal/coach/observation/cs-wa/form"],
    ["talk", "Debrief", "/portal/coach/observation/cs-wa/debrief"],
    ["report", "Send Ayesha the report", "/portal/coach/observation/cs-wa/send"],
  ])("bd-gie5ep — in progress at %s: she can carry on here — the step is hers and the dock opens its v2 screen", async (step, label, href) => {
    C.getObservation.mockResolvedValue(OBS({ step, score: null, sentAt: null, caption: null, imageUrl: null }));
    L.getObservation.mockResolvedValue(VIEW(step));
    renderPage();
    const dock = await screen.findByTestId("obs-dock");
    await waitFor(() => expect(dock).toHaveAttribute("href", href));
    expect(current()).toHaveTextContent(label);
    expect(screen.queryByText("On WhatsApp")).toBeNull();
  });

  it("another coach's WhatsApp observation stays as it was: the report only, the pipeline view is not asked", async () => {
    C.getObservation.mockResolvedValue(OBS({ mine: false, observer: { self: false, name: "Imran S" } }));
    renderPage();
    expect(await screen.findByRole("img", { name: /Ayesha/ })).toBeInTheDocument();
    expect(L.getObservation).not.toHaveBeenCalled();
    expect(screen.queryByTestId("what-you-made")).toBeNull();
  });

  it("a debrief done but no report out is the Send-report step, not every step ticked", async () => {
    C.getObservation.mockResolvedValue(OBS({ mine: false, step: "report", score: null, sentAt: null, caption: null, imageUrl: null }));
    renderPage();
    await screen.findByText("On WhatsApp");
    expect(current()).toHaveTextContent("Send Ayesha the report");
    expect(stepsRegion().getAllByRole("listitem").filter((li) => li.querySelector("[data-testid=step-dot] svg"))).toHaveLength(4);
  });
});
