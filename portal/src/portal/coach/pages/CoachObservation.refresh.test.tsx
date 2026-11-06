import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Rifat", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getObservation: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachObservation from "./CoachObservation";

/**
 * bd-jjcofw.9 — Rifat, 5 Nov (sandbox): "after the audio upload it doesn't go further". She sent her recording at 07:59;
 * the page opened on "Observation analysed · Working" and never asked again. The draft was ready at 08:19; at 09:00 she
 * came back to the same tab and it still said Working, with no Feedback Form button. The page now asks again while the
 * Digital Coach works, and whenever she comes back to the tab; once it is her turn it stops asking.
 */
const C = coach as any;
const L = leader as any;

const OBS = (step: string) => ({
  success: true, id: "cs-1", date: "2026-11-05T07:59:24Z", step, portal: true, mine: true, score: null, dcScore: null,
  summary: null, teacher: { name: "Irfan Wali", teacherExtId: "923300000200", schoolName: "IMS (I-V) G-6/1-1" },
  observer: { self: true, name: "Rifat Yasmeen" }, sentAt: null, caption: null, imageUrl: null, audioUrl: null,
});
const VIEW = (step: string) => ({
  id: "cs-1", createdAt: "2026-11-05T07:59:24Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Irfan Wali", phone: "923300000200" }, lesson: { topic: null, subject: null, hasLessonPlan: true }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Irfan Wali", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1"]}>
    <Routes><Route path="/portal/coach/observation/:id" element={<CoachObservation />} /></Routes>
  </MemoryRouter>,
);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

/** The pipeline finishes after the page opened: the first answers say analysing, every later one says draft. */
function analysingThenDraft() {
  C.getObservation.mockResolvedValueOnce(OBS("analysing")).mockResolvedValue(OBS("draft"));
  L.getObservation.mockResolvedValueOnce(VIEW("analysing")).mockResolvedValue(VIEW("draft"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => { vi.useRealTimers(); });

describe("bd-jjcofw.9 — the observation page follows the Digital Coach", () => {
  it("while it works: no Feedback Form yet; when the draft is ready the page shows it by itself", async () => {
    analysingThenDraft();
    renderPage();
    await flush();
    expect(await screen.findByText("Working")).toBeInTheDocument();
    expect(screen.queryByTestId("obs-dock")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    const dock = await screen.findByTestId("obs-dock");
    expect(dock).toHaveTextContent("Feedback Form");
    expect(dock).toHaveAttribute("href", "/portal/coach/observation/cs-1/form");
  });

  it("coming back to the tab asks again at once (her 09:00 visit)", async () => {
    analysingThenDraft();
    renderPage();
    await flush();
    expect(await screen.findByText("Working")).toBeInTheDocument();
    const before = C.getObservation.mock.calls.length;
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(C.getObservation.mock.calls.length).toBeGreaterThan(before);
    expect(await screen.findByTestId("obs-dock")).toHaveTextContent("Feedback Form");
  });

  it("once it is her turn it stops asking", async () => {
    C.getObservation.mockResolvedValue(OBS("draft"));
    L.getObservation.mockResolvedValue(VIEW("draft"));
    renderPage();
    await flush();
    await screen.findByTestId("obs-dock");
    const calls = C.getObservation.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(C.getObservation.mock.calls.length).toBe(calls);
  });
});
