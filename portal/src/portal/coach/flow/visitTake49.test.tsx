import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.49 (queue #254; the operator 24 Nov ~11:00: "the debrief record button is appearing, even though when you
 * click the record button it actually takes you to the debrief notes. It should be take debrief, next step debrief,
 * debrief notes and record.") — on the v6/v7 switch, coach and principal, English and Urdu, the visit's debrief step is
 * "Next: Take the debrief" with ONE button, Take debrief, that opens the debrief notes (the Debrief page, as before).
 * No Start recording / Upload recording on the visit: recording starts on the notes page, from its floating button.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock("../training/appReady", async (orig) => ({ ...(await orig<Record<string, unknown>>()), coachFeatureReady: () => true }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, coach: { getObservation: vi.fn() }, leader: { getObservation: vi.fn() } }));
vi.mock("../report/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getCoachReport: vi.fn(), markOpened: vi.fn(async () => {}) }));
vi.setConfig({ testTimeout: 20_000 });
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { coach, leader } from "../../services/api";
import CoachObservation from "../pages/CoachObservation";
import { ObserveRoutesProvider } from "../observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "../../teacher/principal/observe";
import { FLOW_V7 } from "./copyV7";
import { stepWords } from "./StatusLine";

const C = coach as unknown as { getObservation: Mock };
const L = leader as unknown as { getObservation: Mock };

const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-1", date: "2026-11-19T05:30:00Z", step: "talk", portal: true, mine: true, score: null, dcScore: 64,
  summary: null, teacher: { name: "Lubna Arif", teacherExtId: "923001110001", schoolName: "IMSG (I-V) G-7/3" },
  observer: { self: true, name: "Hina" }, sentAt: null, caption: null, imageUrl: null, audioUrl: "https://r2.example/lesson.webm", obs612: null, ...extra,
});
const VIEW = (step: string) => ({
  id: "cs-1", createdAt: "2026-11-19T05:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Lubna Arif", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: { intro: "Start with a win.", steps: [] }, recordedAt: null, audioUrl: null, feedback: null },
  report: { status: null, teacherName: "Lubna Arif", teacherPhone: "923001110001", caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
});

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  C.getObservation.mockResolvedValue(OBS());
  L.getObservation.mockResolvedValue(VIEW("talk"));
});

function renderVisit(principal = false) {
  const page = <CoachObservation />;
  render(
    <MemoryRouter initialEntries={["/o/cs-1"]}>
      <Routes>
        <Route path="/o/:id" element={principal ? <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>{page}</ObserveRoutesProvider> : page} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByTestId("visit-next", {}, { timeout: 8000 });
}

describe("the visit's debrief step says Take debrief (bd-o15qnr.49, #254)", () => {
  it("coach, English: Next: Take the debrief, ONE button Take debrief that opens the debrief notes", async () => {
    const next = await renderVisit();
    expect(next).toHaveTextContent("Next: Take the debrief");
    const links = within(next).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Take debrief");
    expect(links[0]).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief");
    // the visit does not offer to record: that is the notes page's floating button
    expect(within(next).queryByRole("link", { name: /Start recording|Upload recording|Record/i })).toBeNull();
    expect(within(next).getByTestId("debrief-due")).toBeInTheDocument();
    expect(next).toHaveTextContent("Read the guide, talk with the teacher, then record it.");
  });

  it("coach, Urdu: اگلا: ڈی بریف کریں and the one button ڈی بریف کریں", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    const next = await renderVisit();
    expect(next).toHaveTextContent("اگلا: ڈی بریف کریں");
    const links = within(next).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("ڈی بریف کریں");
    expect(links[0]).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief");
    expect(within(next).queryByRole("link", { name: /ریکارڈنگ/ })).toBeNull();
  });

  it("principal: the same one button, to the principal's own debrief notes", async () => {
    const next = await renderVisit(true);
    expect(next).toHaveTextContent("Next: Take the debrief");
    const links = within(next).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Take debrief");
    expect(links[0]).toHaveAttribute("href", "/portal/teacher/principal/observation/cs-1/debrief");
  });

  it("the status line names the step the same way: Take the debrief (one word for it everywhere)", async () => {
    await renderVisit();
    const labels = within(screen.getByTestId("status-line")).getAllByTestId("status-label").map((s) => s.textContent);
    expect(labels).toEqual(["Analysed", "Form filled", "Take the debrief", "Yet to send"]);
    expect(stepWords(2, FLOW_V7.en).current).toBe("Take the debrief");
    expect(stepWords(2, FLOW_V7.ur).current).toBe("ڈی بریف کریں");
    // what it is called once done does not change
    expect(stepWords(2, FLOW_V7.en).done).toBe("Debriefed");
  });
});
