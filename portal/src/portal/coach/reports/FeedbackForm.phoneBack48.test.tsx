import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.48 (queue #244; the operator 23 Nov ~23:58: "weird minute errors in the UI like the feedback form
 * navigation stuff") — the phone's Back key inside the Feedback Form, 1-5 (FICO17 v6) and 6-12 (FICO-S). Found on
 * sandbox at 390 px: from an indicator, Android's Back (the browser's step back) left the whole form for the visit
 * page, while the app's own arrow went up one level (indicator → its section → every section → out). And leaving with
 * the arrow pushed the visit page as a NEW page, so the phone's Back then reopened the form.
 *
 * Now both Backs do the same: up one level, then out; and out is the app's Back (the page she came from), so a phone
 * Back after it does not bring the form back. Here the phone's Back is the router's step back (navigate(-1)), which is
 * what BackButtonHandler does on the Android app and what the browser's Back does.
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
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
const L = leader as any;
const CO = coach as any;

/* ── a FICO17 v6 draft: B (no plan), C (two of the eleven), F (one) ── */
const lv = (extra: { id: string; title: string }[] = []) => [
  ...["Not Observed", "Developing", "Proficient", "Highly Effective"].map((t, i) => ({ id: String(i + 1), title: t, description: `${t}: the rubric's words` })),
  ...extra.map((o) => ({ ...o, description: "" })),
];
const V6 = () => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson plan", kind: "moves", header: "", fallback: "No lesson plan was provided.", moves: [] },
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "", indicators: [
      { id: "C1", field: "C1", name: "Quality of Questions Asked by the Teacher", kind: "dc", options: lv(), rumi: "3", rating: "3", evidence: "Two open questions.", improvement: "" },
      { id: "C2", field: "C2", name: "Helping when a child is wrong", kind: "dc", options: lv([{ id: "NA", title: "N/A · No child was wrong" }]), rumi: "2", rating: "2", evidence: "Corrected answers herself.", improvement: "" },
    ] },
    { key: "v6_subject", letter: "F", title: "Subject knowledge", kind: "v6", changeReason: "", indicators: [
      { id: "F1", field: "F1", name: "Accuracy of content", kind: "dc", options: lv(), rumi: "3", rating: "3", evidence: "Correct facts throughout.", improvement: "" },
    ] },
  ],
});

/* ── a FICO-S draft (6-12): section A with two indicators, the checklist, the feedback ── */
const LV = ["Below standard", "Developing", "Proficient", "Exemplary"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}`, description: `What level ${i + 1} looks like` }));
const item = (code: string, extra: Record<string, unknown> = {}) => ({
  type: "field", name: code, role: "item", input: "radio", kind: "level", n: null, short: `Section · ${code}`, text: `Look for ${code}`,
  options: LV, required: true, max: null, about: `What ${code} looks at.`, notes: `Scoring note for ${code}.`, ...extra,
});
const ev = (code: string) => ({ type: "field", name: `ev_${code}`, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Evidence: What you saw and heard", options: null, required: true, max: 600 });
const FICOS = () => ({
  status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
  toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "FS_START", kind: "start", parts: [{ type: "heading", text: "FICO 6-12 · Classroom observation" }] },
    { id: "FS_INTRO_A", kind: "intro", sec: "A", title: "Lesson planning", parts: [{ type: "heading", text: "Section A · Lesson planning" }] },
    { id: "FS_A_ONE", kind: "indicator", sec: "A", code: "A1", name: "Lesson objective", starred: false, parts: [
      { type: "heading", text: "A1 · Lesson objective" }, item("A1", { dcLevel: "3" }), ev("A1")] },
    { id: "FS_A_TWO", kind: "indicator", sec: "A", code: "A2", name: "Opening the lesson", starred: false, parts: [
      { type: "heading", text: "A2 · Opening the lesson" }, item("A2"), ev("A2")] },
    { id: "FS_CHECKLIST", kind: "checklist", parts: [{ type: "heading", text: "Checklist" },
      { type: "field", name: "cl_1", role: "item", input: "radio", kind: "yes_no", n: null, short: "Notebooks checked", text: "Notebooks checked", options: [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }], required: true, max: null }] },
  ],
  values: { A1: "3", ev_A1: "Two open questions." }, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
});
const VIEW = { id: "cs-1", teacher: { name: "Lubna Arif", phone: "923001110001" }, report: { teacherName: "Lubna Arif" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };

/* ── the router: she came to the form from the visit page; the phone's Back is the router's step back ── */
let nav: NavigateFunction;
function Grab() { nav = useNavigate(); return null; }
const renderPage = () => render(
  <ObserveRoutesProvider value={COACH_OBSERVE_ROUTES}>
    <MemoryRouter initialEntries={["/portal/coach/observation/cs-1", "/portal/coach/observation/cs-1/form"]} initialIndex={1}>
      <Grab />
      <Routes>
        <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
        <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>
  </ObserveRoutesProvider>,
);
const phoneBack = async () => { await act(async () => { nav(-1); }); };
const arrow = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));
const openSection = async (name: RegExp) => { fireEvent.click(await screen.findByRole("button", { name }, { timeout: 8000 })); return screen.findByTestId("ff-section"); };
const openRow = async (code: string) => {
  fireEvent.click(within(screen.getByTestId("ff-section")).getByRole("button", { name: new RegExp(`^${code}\\b`) }));
  return screen.findByTestId("ff-indicator");
};

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  L.saveObservationDraft.mockResolvedValue({ success: true });
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...FICOS(), values }));
  CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: null });
});

describe("1-5 (FICO17 v6): the phone's Back steps up one level, like the app's arrow", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(V6()); });

  it("indicator → its section → every section → the visit page", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    await openRow("C1");
    await phoneBack();
    expect(await screen.findByTestId("ff-section")).toHaveTextContent("C. What the teacher does");
    expect(screen.queryByText("observation page")).toBeNull();
    await phoneBack();
    expect(await screen.findByTestId("ff-sections")).toBeInTheDocument();
    await phoneBack();
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("Next and Previous between indicators add no step: one Back from C2 is the section", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    await openRow("C1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(within(screen.getByTestId("ff-indicator")).getAllByText("C2").length).toBeGreaterThan(0));
    await phoneBack();
    expect(await screen.findByTestId("ff-section")).toHaveTextContent("C. What the teacher does");
  });

  it("'Next to check' from every section opens the indicator; Back is its section, then every section", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    fireEvent.click(within(screen.getByTestId("form-dock")).getByRole("button", { name: /Next to check/ }));
    await screen.findByTestId("ff-indicator");
    await phoneBack();
    expect(await screen.findByTestId("ff-section")).toBeInTheDocument();
    await phoneBack();
    expect(await screen.findByTestId("ff-sections")).toBeInTheDocument();
  });

  it("the arrow and the phone's Back stay in step: arrow up, phone Back up, then out", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    await openRow("C1");
    arrow();
    expect(await screen.findByTestId("ff-section")).toBeInTheDocument();
    await phoneBack();
    expect(await screen.findByTestId("ff-sections")).toBeInTheDocument();
    await phoneBack();
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("leaving with the arrow is a step back: a phone Back after it does not reopen the form", async () => {
    renderPage();
    await screen.findByTestId("ff-sections");
    arrow();
    expect(await screen.findByText("observation page")).toBeInTheDocument();
    await phoneBack();
    expect(screen.queryByTestId("ff-sections")).toBeNull();
    expect(screen.getByText("observation page")).toBeInTheDocument();
  });
});

describe("6-12 (FICO-S): the same levels, the same Back", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(FICOS()); });

  it("indicator → its section → every section → the visit page", async () => {
    renderPage();
    await openSection(/^A\. /);
    await openRow("A1");
    await phoneBack();
    expect(await screen.findByTestId("ff-section")).toBeInTheDocument();
    expect(screen.queryByText("observation page")).toBeNull();
    await phoneBack();
    expect(await screen.findByTestId("ff-sections")).toBeInTheDocument();
    await phoneBack();
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("leaving with the arrow is a step back: a phone Back after it does not reopen the form", async () => {
    renderPage();
    await screen.findByTestId("ff-sections", undefined, { timeout: 8000 });
    arrow();
    expect(await screen.findByText("observation page")).toBeInTheDocument();
    await phoneBack();
    expect(screen.queryByTestId("ff-sections")).toBeNull();
  });
});

/**
 * bd-o15qnr.48 — the FICO-S form's chip read "FICO 6-12 v1.2 · FICO 6-12 · G7" on production (the operator's test
 * account, 24 Nov): the tool's name again after the rubric label that already starts with it. Now the name shows only
 * when the label does not already say it (FDE's "FDE v1 · Maths & Science tool · G7" is unchanged).
 */
describe("6-12 (FICO-S): the rubric chip says the rubric once", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(FICOS()); });

  it("'FICO 6-12 v1.2 · G7', not 'FICO 6-12 v1.2 · FICO 6-12 · G7'", async () => {
    renderPage();
    const chip = await screen.findByTestId("rubric-label", undefined, { timeout: 8000 });
    expect(chip).toHaveTextContent("FICO 6-12 v1.2 · G7");
    expect(chip.textContent).not.toContain("· FICO 6-12 ·");
  });
});
