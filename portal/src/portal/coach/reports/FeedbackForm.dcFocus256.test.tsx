import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * Queue #256 (the operator 24 Nov ~11:20: "indicator to work on should be pre filled by DC as well") — the FICO 6-12
 * Feedback Form's "Indicator to work on" opens on the Digital Coach's pick (the bot sends it as the value and names it
 * `dcChoice` on the field), marked the way its level is marked on a level card (#229): a purple edge and "Digital Coach"
 * at the end, on that option in the sheet and on the field while it is the one chosen. She can pick another; the mark
 * stays on the Digital Coach's option. No pick from the Digital Coach: the field opens empty, nothing marked.
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

import { coach, leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";
import { COACH_OBSERVE_ROUTES, ObserveRoutesProvider } from "../observe/observeRoutes";

vi.setConfig({ testTimeout: 30_000 });
const L = leader as unknown as Record<string, Mock>;
const CO = coach as unknown as Record<string, Mock>;

const LV = ["Below standard", "Developing", "Proficient", "Exemplary"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}`, description: `What level ${i + 1} looks like` }));
const item = (code: string, extra: Record<string, unknown> = {}) => ({
  type: "field", name: code, role: "item", input: "radio", kind: "level", n: null, short: `Section · ${code}`, text: `Look for ${code}`,
  options: LV, required: true, max: null, about: `What ${code} looks at.`, notes: `Scoring note for ${code}.`, ...extra,
});
const ev = (code: string) => ({ type: "field", name: `ev_${code}`, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Evidence: What you saw and heard", options: null, required: true, max: 600 });
const text = (name: string, label: string, required = true) => ({ type: "field", name, role: "other", input: "textarea", kind: null, n: null, short: null, text: label, options: null, required, max: 600 });
const FOCUS_OPTS = [
  { id: "A1", title: "A1 · Lesson objective", description: "Lesson objective" },
  { id: "B1", title: "B1 · Wait time", description: "Wait time" },
];
const focus = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  type: "field", name, role: "other", input: "dropdown", kind: null, n: null, short: null, text: label, required: name === "fs_focus", max: null, options: FOCUS_OPTS, ...extra,
});

const DRAFT = ({ dcChoice, values }: { dcChoice?: string; values?: Record<string, string> } = {}) => ({
  status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
  toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "FS_START", kind: "start", parts: [{ type: "heading", text: "FICO 6-12 · Classroom observation" }] },
    { id: "FS_INTRO_A", kind: "intro", sec: "A", title: "Lesson planning", parts: [{ type: "heading", text: "Section A · Lesson planning" }] },
    { id: "FS_A_ONE", kind: "indicator", sec: "A", code: "A1", name: "Lesson objective", starred: false, parts: [{ type: "heading", text: "A1 · Lesson objective" }, item("A1", { dcLevel: "3" }), ev("A1")] },
    { id: "FS_INTRO_B", kind: "intro", sec: "B", title: "Questioning", parts: [{ type: "heading", text: "Section B · Questioning" }] },
    { id: "FS_B_ONE", kind: "indicator", sec: "B", code: "B1", name: "Wait time", starred: false, parts: [{ type: "heading", text: "B1 · Wait time" }, item("B1", { dcLevel: "1" }), ev("B1")] },
    { id: "FS_FEEDBACK", kind: "feedback", parts: [
      { type: "heading", text: "Feedback for the teacher" },
      text("fb_strengths", "Strengths: 1-2 things that went well"),
      focus("fs_focus", "Indicator to work on", dcChoice ? { dcChoice } : {}),
      text("fs_action", "Action: One concrete thing to do"),
      focus("fs_focus_2", "Second indicator"),
    ] },
  ],
  values: { A1: "3", B1: "1", ...(values || {}) }, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
});
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
const openFeedback = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /^Feedback for the teacher/ }, { timeout: 8000 }));
  return screen.findByTestId("ff-section");
};
const focusField = (sec: HTMLElement) => within(sec).getByRole("button", { name: /^Indicator to work on,/ });
const openSheet = async (sec: HTMLElement) => {
  fireEvent.click(focusField(sec));
  return screen.findByRole("dialog", { name: "Indicator to work on" });
};
const rowOf = (tray: HTMLElement, code: string) => within(tray).getAllByRole("button").find((b) => b.textContent?.includes(`${code} ·`))!;

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  CO.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
  CO.getObservation.mockResolvedValue({ audioUrl: null });
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...DRAFT({ dcChoice: "B1" }), values }));
});

describe("queue #256: Indicator to work on opens on the Digital Coach's pick", () => {
  it("pre-selected and marked: the field reads its pick with \"Digital Coach\", and so does its row in the sheet", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ dcChoice: "B1", values: { fs_focus: "B1" } }));
    const sec = await openFeedback();
    const field = focusField(sec);
    expect(field).toHaveTextContent("B1 · Wait time");
    expect(within(field).getByTestId("dc-tag")).toHaveTextContent("Digital Coach");
    expect(field).toHaveAccessibleName(/Indicator to work on, B1 · Wait time, Digital Coach/);
    const tray = await openSheet(sec);
    expect(within(rowOf(tray, "B1")).getByTestId("dc-tag")).toHaveTextContent("Digital Coach");
    expect(within(rowOf(tray, "A1")).queryByTestId("dc-tag")).toBeNull();
  });

  it("she can pick another: the field no longer says Digital Coach, the sheet still marks its pick", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ dcChoice: "B1", values: { fs_focus: "B1" } }));
    const sec = await openFeedback();
    let tray = await openSheet(sec);
    fireEvent.click(rowOf(tray, "A1"));
    const field = focusField(sec);
    expect(field).toHaveTextContent("A1 · Lesson objective");
    expect(within(field).queryByTestId("dc-tag")).toBeNull();
    tray = await openSheet(sec);
    expect(within(rowOf(tray, "B1")).getByTestId("dc-tag")).toBeInTheDocument();
    expect(within(rowOf(tray, "A1")).queryByTestId("dc-tag")).toBeNull();
  });

  it("only the first Indicator to work on is marked; the second indicator is hers alone", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ dcChoice: "B1", values: { fs_focus: "B1" } }));
    const sec = await openFeedback();
    fireEvent.click(within(sec).getByRole("button", { name: /^Second indicator,/ }));
    const tray = await screen.findByRole("dialog", { name: "Second indicator" });
    expect(within(tray).queryByTestId("dc-tag")).toBeNull();
  });

  it("no pick from the Digital Coach: the field opens empty, nothing marked", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT());
    const sec = await openFeedback();
    const field = focusField(sec);
    expect(field).toHaveTextContent("Select");
    expect(within(field).queryByTestId("dc-tag")).toBeNull();
    const tray = await openSheet(sec);
    expect(within(tray).queryByTestId("dc-tag")).toBeNull();
  });

  it("Urdu: the mark says ڈیجیٹل کوچ", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObservationDraft.mockResolvedValue(DRAFT({ dcChoice: "B1", values: { fs_focus: "B1" } }));
    const sec = await openFeedback();
    expect(within(focusField(sec)).getByTestId("dc-tag")).toHaveTextContent("ڈیجیٹل کوچ");
    // Picked AND the Digital Coach's: its purple edge must survive right-to-left too (the selected row's rtl: start
    // bar once replaced it on Urdu screens), and the selected start bar stays, in both directions.
    const tray = await openSheet(sec);
    const row = rowOf(tray, "B1");
    expect(within(row).getByTestId("dc-tag")).toHaveTextContent("ڈیجیٹل کوچ");
    expect(row.className).toMatch(/(^|\s)shadow-\[inset_3px_0_0_#33374a,inset_0_0_0_2px_#6e52e0\]/);
    expect(row.className).toMatch(/(^|\s)rtl:shadow-\[inset_-3px_0_0_#33374a,inset_0_0_0_2px_#6e52e0\]/);
  });
});
