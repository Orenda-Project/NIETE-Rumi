import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-o15qnr.41 (queue #228) — the Feedback Form waits for the Digital Coach's draft. Prod, 23 Nov: a grade 6-12 visit's
 * form was opened 16 s after the recording landed, empty; Rumi's pre-fill landed a minute later and the open page's next
 * save wrote over it. The operator: "dont open the form till analysis is complete."
 *
 * The bot now refuses the draft as 409 { reason: 'analysing' } while the Digital Coach is on the lesson (every rubric).
 * The form then shows the visit's own analysing card ("Digital Coach is listening to the lesson … This page updates by
 * itself"), no fields, no Next/Save, asks again on its own, and opens with the draft when it lands. Both looks (the v6/v7
 * switch on and off), coach and principal (one page).
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), saveObservationDraft: vi.fn(), saveObs612Form: vi.fn() },
}));
const flow = vi.hoisted(() => ({ on: false as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";

const L = leader as any;
const ANALYSING = () => Object.assign(new Error("HTTP 409"), { response: { status: 409, data: { status: "not_ready", reason: "analysing" } } });
const DRAFT = () => ({
  saved: false, editable: true,
  scale: [{ id: "0", title: "0 · Not observed" }, { id: "1", title: "1 · Developing" }, { id: "2", title: "2 · Proficient" }],
  fidelityScale: [],
  sections: [
    { key: "culture", letter: "C", title: "Classroom culture", kind: "indicators", notes: [],
      indicators: [{ id: "C1", field: "C1", name: "Positive learning environment", rating: "1", evidence: "Greeted students by name", improvement: "" }] },
    { key: "engage", letter: "D", title: "Student engagement", kind: "indicators", notes: [],
      indicators: [{ id: "D1", field: "D1", name: "Questioning", rating: "2", evidence: "", improvement: "" }] },
  ],
});
const VIEW = { id: "cs-1", teacher: { name: "Ayesha Bibi" }, report: { teacherName: "Ayesha Bibi" }, step: "analysing", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: false });
  L.getObservation.mockResolvedValue(VIEW);
  L.saveObservationDraft.mockResolvedValue({ success: true });
});
afterEach(() => { vi.useRealTimers(); });

describe.each([["v7 look (switch on)", true], ["today's look (switch off)", false]])("Feedback Form waits for the Digital Coach — %s", (_n, on) => {
  beforeEach(() => { flow.on = on; });

  it("while the draft is being made: the analysing card, no fields, no Next or Save, and no load error", async () => {
    L.getObservationDraft.mockRejectedValue(ANALYSING());
    renderPage();
    await settle();
    expect(screen.getByTestId("stage-analysing")).toHaveTextContent("Digital Coach is listening to the lesson");
    expect(screen.queryByTestId("indicator")).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Next part/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("asks again by itself and opens the form when the draft lands", async () => {
    L.getObservationDraft.mockRejectedValueOnce(ANALYSING()).mockRejectedValueOnce(ANALYSING()).mockResolvedValue(DRAFT());
    renderPage();
    await settle();
    expect(screen.getByTestId("stage-analysing")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await settle();
    expect(screen.getByTestId("stage-analysing")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await settle();
    expect(screen.queryByTestId("stage-analysing")).toBeNull();
    expect(screen.getByText("Classroom culture", { exact: false })).toBeTruthy();
    expect(L.getObservationDraft).toHaveBeenCalledTimes(3);
  });

  it("stops asking once the form is open", async () => {
    L.getObservationDraft.mockRejectedValueOnce(ANALYSING()).mockResolvedValue(DRAFT());
    renderPage();
    await settle();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await settle();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await settle();
    expect(L.getObservationDraft).toHaveBeenCalledTimes(2);
  });
});
