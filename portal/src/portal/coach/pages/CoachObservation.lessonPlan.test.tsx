import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { act } from "react";
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
 * bd-fmf24g.66 — the observation page says what became of the plan the coach attached: one "Lesson plan" row, only for
 * her own file, with Reading / Read (and the topic the reader found) / Couldn't read (Not scored). A library plan or
 * none shows no row. Words in English and Urdu.
 */
const C = coach as any;
const L = leader as any;

const OBS = {
  success: true, id: "cs-1", date: "2026-10-06T06:30:00Z", step: "draft", portal: true, mine: true, score: null, dcScore: 64,
  summary: "Clear modelling.", teacher: { name: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1" },
  observer: { self: true, name: "Hataf Atif" }, sentAt: null, caption: null, imageUrl: null, audioUrl: null,
};
const VIEW = (lessonPlan?: Record<string, unknown>) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step: "draft", problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: true }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: null, teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...(lessonPlan ? { lessonPlan } : {}),
});
const OWN = (state: string, topic: string | null = null) => ({ source: "own", format: "pdf", state, topic });

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1"]}>
    <Routes><Route path="/portal/coach/observation/:id" element={<CoachObservation />} /></Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  C.getObservation.mockResolvedValue(OBS);
  L.getObservationDraft.mockResolvedValue({ saved: false, editable: true, scale: [], fidelityScale: [], sections: [] });
});

describe("the Lesson plan row", () => {
  it("Reading: her own plan is being read", async () => {
    L.getObservation.mockResolvedValue(VIEW(OWN("reading")));
    renderPage();
    const row = await screen.findByTestId("lesson-plan-row");
    expect(row).toHaveTextContent("Their own plan");
    expect(row).toHaveTextContent("PDF");
    expect(within(row).getByText("Reading")).toBeInTheDocument();
  });

  it("Read: shows the topic the reader found", async () => {
    L.getObservation.mockResolvedValue(VIEW(OWN("read", "Place value & counting 4-digit numbers")));
    renderPage();
    const row = await screen.findByTestId("lesson-plan-row");
    expect(row).toHaveTextContent("Place value & counting 4-digit numbers");
    expect(row).toHaveTextContent("Their own plan · PDF");
    expect(within(row).getByText("Read")).toBeInTheDocument();
  });

  it("Couldn't read: says the section is not scored, in the app (no link, no sentence)", async () => {
    L.getObservation.mockResolvedValue(VIEW(OWN("unreadable")));
    renderPage();
    const row = await screen.findByTestId("lesson-plan-row");
    expect(within(row).getByText("Couldn't read")).toBeInTheDocument();
    expect(row).toHaveTextContent("Not scored");
    expect(within(row).queryByRole("link")).toBeNull();
    expect(screen.queryByText(/see all|see more/i)).toBeNull();
  });

  it.each([
    ["a library plan", { source: "library", format: "pdf", state: null, topic: null }],
    ["no plan", { source: "none", format: null, state: null, topic: null }],
    ["an older bot (no field)", undefined],
  ])("%s: no row", async (_n, lp) => {
    L.getObservation.mockResolvedValue(VIEW(lp as any));
    renderPage();
    await waitFor(() => expect(L.getObservation).toHaveBeenCalled());
    await screen.findByText("Steps");
    expect(screen.queryByTestId("lesson-plan-row")).toBeNull();
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObservation.mockResolvedValue(VIEW(OWN("unreadable")));
    renderPage();
    const row = await screen.findByTestId("lesson-plan-row");
    expect(row).toHaveTextContent("ان کا اپنا پلان");
    expect(within(row).getByText("پڑھ نہیں سکے")).toBeInTheDocument();
  });
});
