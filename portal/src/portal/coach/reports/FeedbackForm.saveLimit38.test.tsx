import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.38 (queue #219) — prod, 22 Nov 00:13 PKT, the operator's principal account: the v7 Feedback Form sat on
 * "Saving" for 45+ s although the server had saved it in 1 s (POST /leader/observe/:id/draft 200, 1028 ms; the bot wrote
 * observer_review_complete at 00:13:00.6). The page then sent nothing for 49 s. The save had no time limit, and while
 * it waits the tray's buttons are disabled: a reply that never reaches the page left her on "Saving" with no way on.
 *
 * On the v7 switch, now:
 *   still saving   after SAVE_SLOW_MS the tray says "Kept on this phone" under the Saving button
 *   a lost try     (no answer in SAVE_TRY_MS, or no answer at all) is sent once more with the same answers (the bot
 *                  takes a re-save: it is how the form is edited after a save)
 *   either answer  whichever try answers first moves her on to the observation
 *   both lost      "No connection · Kept on this phone", and Save works again
 *   a refusal      (the server answered with an error) is shown as before, never re-sent
 *   off the switch today's single call, unchanged
 *   the funnel     form.save_slow / form.save_retry / form.save_lost (POST /funnel/coach-flow)
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn(), getObservation: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), saveObservationDraft: vi.fn(), saveObs612Form: vi.fn() },
}));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));
const tracked = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("../flow/track", async (orig) => ({ ...(await orig<object>()), trackFlow: (a: string) => { tracked.list.push(a); } }));

import { coach, leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";
import { SAVE_SLOW_MS, SAVE_TRY_MS } from "./saveTry";
import { COACH_OBSERVE_ROUTES, ObserveRoutesProvider } from "../observe/observeRoutes";

const L = leader as unknown as Record<string, Mock>;
const CO = coach as unknown as Record<string, Mock>;

const lv = () => ["Not Observed", "Developing", "Proficient", "Highly Effective"].map((t, i) => ({ id: String(i + 1), title: t, description: t }));
// A FICO17 v6 draft saved once already (her levels in place), so every section is green and Save is live at once.
const V6_SAVED = {
  kind: "fico17_v6", saved: true, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6.1" },
  scale: [], fidelityScale: [], notes: [],
  sections: [
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "", indicators: [
      { id: "C1", field: "C1", name: "Quality of Questions", kind: "dc", options: lv(), rumi: "2", rating: "2", evidence: "Closed questions.", improvement: "",
        rumiEvidence: { because: "Closed questions.", items: [{ time: "04:30", quote: "اب ہم کیا کریں گے؟" }] } },
      { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv(), body: "Who answered.", rating: "4", why: "" },
    ] },
  ],
};
// The older (non-v6) review form in the v7 look: one part, Save in the dock.
const FICO = {
  saved: false, editable: true, scale: [{ id: "0", title: "0 · Not observed" }, { id: "1", title: "1 · Developing" }], fidelityScale: [],
  sections: [{ key: "domain_b", letter: "B", title: "Teaching", kind: "indicators", notes: [], indicators: [{ id: "B1", field: "B1", name: "Questions", rating: "1", evidence: "", improvement: "" }] }],
};
const VIEW = { id: "cs-1", teacher: { name: "Lubna Arif", phone: "923001110001" }, report: { teacherName: "Lubna Arif" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };

const renderPage = () => render(
  <ObserveRoutesProvider value={COACH_OBSERVE_ROUTES}>
    <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
      <Routes>
        <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
        <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>
  </ObserveRoutesProvider>,
);

const NEVER = () => new Promise(() => {});
const lost = () => Promise.reject(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

/** Open the v6 form, tap Save, then Save and continue in the tray. */
const saveV6 = async (save = "Save", go = "Save and continue") => {
  renderPage();
  await flush(); await flush();
  const dock = within(screen.getByTestId("form-dock"));
  fireEvent.click(dock.getByRole("button", { name: save }));
  const tray = within(screen.getByRole("dialog"));
  fireEvent.click(tray.getByRole("button", { name: go }));
  await flush();
  return tray;
};

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  localStorage.clear();
  vi.clearAllMocks();
  tracked.list = [];
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(V6_SAVED);
  L.saveObservationDraft.mockResolvedValue({ success: true });
  CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: null });
});
afterEach(() => { vi.useRealTimers(); });

describe("bd-o15qnr.38 — the v7 save has a time limit and a way on", () => {
  it("the limits: 'kept on this phone' after 6 s; a try gets 15 s", () => {
    expect(SAVE_SLOW_MS).toBe(6000);
    expect(SAVE_TRY_MS).toBe(15000);
  });

  it("a quick answer: on to the observation, no slow line, nothing tracked", async () => {
    await saveV6();
    await flush();
    expect(screen.getByText("observation page")).toBeInTheDocument();
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(1);
    expect(tracked.list).toEqual([]);
  });

  it("no answer: 'Kept on this phone' under Saving after 6 s, the buttons still waiting", async () => {
    L.saveObservationDraft.mockImplementation(NEVER);
    const tray = await saveV6();
    expect(tray.getByRole("button", { name: "Saving" })).toBeDisabled();
    expect(screen.queryByText(/Kept on this phone/)).toBeNull();
    await advance(SAVE_SLOW_MS);
    expect(tray.getByRole("status")).toHaveTextContent("Kept on this phone");
    expect(tracked.list).toEqual(["form.save_slow"]);
  });

  it("no answer in 15 s: the same answers are sent once more; that answer moves her on", async () => {
    L.saveObservationDraft.mockImplementationOnce(NEVER).mockResolvedValueOnce({ success: true });
    await saveV6();
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(1);
    await advance(SAVE_TRY_MS);
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(2);
    expect(L.saveObservationDraft.mock.calls[1]).toEqual(L.saveObservationDraft.mock.calls[0]);
    await flush();
    expect(screen.getByText("observation page")).toBeInTheDocument();
    expect(tracked.list).toEqual(["form.save_slow", "form.save_retry"]);
  });

  it("the first try answers late, while the second is out: that answer is enough", async () => {
    let first: (v: unknown) => void = () => {};
    L.saveObservationDraft.mockImplementationOnce(() => new Promise((r) => { first = r; })).mockImplementationOnce(NEVER);
    await saveV6();
    await advance(SAVE_TRY_MS);
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(2);
    await act(async () => { first({ success: true }); });
    await flush();
    expect(screen.getByText("observation page")).toBeInTheDocument();
  });

  it("a lost connection (no answer at all) is sent once more at once", async () => {
    L.saveObservationDraft.mockImplementationOnce(lost).mockResolvedValueOnce({ success: true });
    await saveV6();
    await flush();
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(2);
    await flush();
    expect(screen.getByText("observation page")).toBeInTheDocument();
    expect(tracked.list).toEqual(["form.save_retry"]);
  });

  it("both tries lost: No connection · Kept on this phone, and Save works again", async () => {
    L.saveObservationDraft.mockImplementation(NEVER);
    await saveV6();
    await advance(SAVE_TRY_MS);
    await advance(SAVE_TRY_MS);
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("No connection · Kept on this phone");
    expect(screen.queryByText("observation page")).toBeNull();
    expect(tracked.list).toEqual(["form.save_slow", "form.save_retry", "form.save_lost"]);
    // Save again: a third call, and this time it answers.
    L.saveObservationDraft.mockResolvedValueOnce({ success: true });
    fireEvent.click(within(screen.getByTestId("form-dock")).getByRole("button", { name: "Save" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save and continue" }));
    await flush();
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(3);
    expect(screen.getByText("observation page")).toBeInTheDocument();
  });

  it("a refusal (the server answered 409) is shown at once and never re-sent", async () => {
    L.saveObservationDraft.mockRejectedValueOnce({ response: { status: 409, data: {} } });
    await saveV6();
    await flush();
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot change it now");
    expect(tracked.list).toEqual([]);
  });

  it("the older form in the v7 look has the same limit", async () => {
    L.getObservationDraft.mockResolvedValue(FICO);
    L.saveObservationDraft.mockImplementationOnce(NEVER).mockResolvedValueOnce({ success: true });
    renderPage();
    await flush(); await flush();
    fireEvent.click(within(screen.getByTestId("form-dock")).getByRole("button", { name: "Save" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save and continue" }));
    await flush();
    await advance(SAVE_SLOW_MS);
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("Kept on this phone");
    await advance(SAVE_TRY_MS - SAVE_SLOW_MS);
    await flush();
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(2);
    expect(screen.getByText("observation page")).toBeInTheDocument();
  });

  it("off the switch: today's single call, no limit, no retry", async () => {
    flow.on = false;
    L.getObservationDraft.mockResolvedValue(FICO);
    L.saveObservationDraft.mockImplementation(NEVER);
    renderPage();
    await flush(); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save and continue" }));
    await flush();
    await advance(SAVE_TRY_MS * 3);
    expect(L.saveObservationDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Kept on this phone/)).toBeNull();
    expect(tracked.list).toEqual([]);
  });

  it("Urdu: the two new lines", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.saveObservationDraft.mockImplementation(NEVER);
    await saveV6("محفوظ کریں", "محفوظ کریں اور آگے");
    await advance(SAVE_SLOW_MS);
    expect(screen.getByRole("status")).toHaveTextContent("اس فون میں محفوظ");
    await advance(SAVE_TRY_MS * 2);
    expect(screen.getByRole("alert")).toHaveTextContent("رابطہ نہیں ہو سکا · اس فون میں محفوظ");
  });
});
