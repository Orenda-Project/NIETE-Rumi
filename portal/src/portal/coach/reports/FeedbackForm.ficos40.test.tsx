import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.40.6 (queue #229; the operator 23 Nov ~15:50: "why is 6-12 so different looking than the 1-5 one? Can they be
 * the same?") — on the v6/v7 switch the FICO-S (grades 6-12) Feedback Form is drawn with the 1-5 form's own pieces
 * (FormV7Nav.tsx) and moves the same way; only the rubric's content differs:
 *
 *   sections        every section as a row (A-E, then the checks and the feedback), a green tick or a yellow dot, n/m done;
 *                   no "Part 1 of 31" strip. The dock: "Submit (n sections to finish)" until all are green, then Submit.
 *   a section       the section chips (n/m), its title, "n of m checked", one row per indicator: code, name, the Digital
 *                   Coach's line, the level chip ("Yours to set" when none), the mark. Next to check walks the yellow ones.
 *   one indicator   Previous / the code and name / Next; the line under the name with FICO-S's scoring note folded in as
 *                   the hint; the card: You · Digital Coach legend, the levels with the Digital Coach's marked ON its card
 *                   (N/A a 5th card), "Changed from …" and "Why you changed it" when changed; the Digital Coach's evidence;
 *                   the observer's Evidence; "Agree and next" saves and moves on, or names what is missing.
 *   the checks and the feedback   their own fields under the same section head.
 *
 * Saving is the bot's FICO-S save (every answer, as today); Submit asks the bot first, then the tray. A draft from an older
 * bot (no section `kind`) keeps today's part-by-part screen.
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

const LV = ["Below standard", "Developing", "Proficient", "Exemplary"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}`, description: `What level ${i + 1} looks like` }));
const NA = { id: "NA", title: "N/A · No answer was wrong", description: "Nothing was wrong in this lesson." };
const item = (code: string, extra: Record<string, unknown> = {}) => ({
  type: "field", name: code, role: "item", input: "radio", kind: "level", n: null, short: `Section · ${code}`, text: `Look for ${code}`,
  options: LV, required: true, max: null, about: `What ${code} looks at.`, notes: `Scoring note for ${code}.\nHow: In class`, ...extra,
});
const ev = (code: string) => ({ type: "field", name: `ev_${code}`, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Evidence: What you saw and heard", options: null, required: true, max: 600 });
const chg = (code: string) => ({ type: "field", name: `chg_${code}`, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Why you changed: Only if you changed the level", options: null, required: false, max: 600 });
const yesNo = (name: string, text: string) => ({ type: "field", name, role: "item", input: "radio", kind: "yes_no", n: null, short: text, text, options: [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }], required: true, max: null });
const text = (name: string, label: string, required = true) => ({ type: "field", name, role: "other", input: "textarea", kind: null, n: null, short: null, text: label, options: null, required, max: 600 });

const EV_A1 = "Two open questions; the rest were recall. [04:30] \"Why is it seven?\"";
const DRAFT = (over: Record<string, unknown> = {}) => ({
  status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
  toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "FS_START", kind: "start", parts: [{ type: "heading", text: "FICO 6-12 · Classroom observation" }, { type: "sub", text: "Score each indicator 1-4." }] },
    { id: "FS_INTRO_A", kind: "intro", sec: "A", title: "Lesson planning", parts: [{ type: "heading", text: "Section A · Lesson planning" }, { type: "sub", text: "Is the lesson planned?" }] },
    { id: "FS_A_ONE", kind: "indicator", sec: "A", code: "A1", name: "Lesson objective", starred: false, parts: [
      { type: "heading", text: "A1 · Lesson objective" },
      { type: "sub", text: "The Digital Coach chose 3 · Proficient from the recording.", dc: "chose" },
      item("A1", { dcLevel: "3", dcEvidence: { because: "Two open questions; the rest were recall.", items: [{ time: "04:30", quote: "Why is it seven?" }] } }),
      ev("A1"), chg("A1"),
    ] },
    { id: "FS_A_TWO", kind: "indicator", sec: "A", code: "A2", name: "Opening the lesson", starred: true, parts: [
      { type: "heading", text: "★ A2 · Opening the lesson" },
      { type: "sub", text: "★ Starred: yours alone. The Digital Coach never scores this one; set it from what you saw." },
      item("A2", { options: [...LV, NA] }), ev("A2"),
    ] },
    { id: "FS_INTRO_B", kind: "intro", sec: "B", title: "Questioning", parts: [{ type: "heading", text: "Section B · Questioning" }] },
    { id: "FS_B_ONE", kind: "indicator", sec: "B", code: "B1", name: "Wait time", starred: false, parts: [
      { type: "heading", text: "B1 · Wait time" },
      { type: "sub", text: "The Digital Coach could not set a level from the recording (Too noisy). Choose the level you saw.", dc: "none" },
      item("B1"), ev("B1"), chg("B1"),
    ] },
    { id: "FS_CHECKLIST", kind: "checklist", parts: [{ type: "heading", text: "Checklist" }, { type: "sub", text: "Choose Yes or No for every one." }, yesNo("cl_1", "Notebooks checked")] },
    { id: "FS_FEEDBACK", kind: "feedback", parts: [{ type: "heading", text: "Feedback for the teacher" }, { type: "score", total: 3, max: 12, pct: 25, band: null }, text("fb_strengths", "Strengths: 1-2 things that went well"), text("fs_focus_2", "Second indicator", false)] },
  ],
  values: { A1: "3", ev_A1: EV_A1 }, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
  ...over,
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
const sections = () => within(screen.getByTestId("ff-sections"));
const openSection = async (name: RegExp) => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name }, { timeout: 8000 }));
  return screen.findByTestId("ff-section");
};
const openIndicator = async (section: RegExp, code: string) => {
  const sec = await openSection(section);
  fireEvent.click(within(sec).getByRole("button", { name: new RegExp(`^${code}\\b`) }));
  return screen.findByTestId("ff-indicator");
};
const saved = (over: Record<string, string> = {}) => ({ ...DRAFT(), values: { ...DRAFT().values, ...over } });

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservationDraft.mockResolvedValue(DRAFT());
  L.getObservation.mockResolvedValue(VIEW);
  CO.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
  CO.getObservation.mockResolvedValue({ audioUrl: null });
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...DRAFT(), values }));
});

describe("FICO-S on the 1-5 form's pieces: the sections", () => {
  it("every section as a row with its mark and n/m done; no part strip", async () => {
    renderPage();
    await screen.findByTestId("ff-sections", undefined, { timeout: 8000 });
    expect(sections().getByRole("button", { name: /^A\. Lesson planning/ })).toBeInTheDocument();
    expect(sections().getByRole("button", { name: /^B\. Questioning/ })).toBeInTheDocument();
    expect(sections().getByRole("button", { name: /^Checklist/ })).toBeInTheDocument();
    expect(sections().getByRole("button", { name: /^Feedback for the teacher/ })).toBeInTheDocument();
    expect(sections().getAllByRole("button")).toHaveLength(4);
    expect(within(sections().getByRole("button", { name: /^A\. / })).getByText("0/2 done")).toBeInTheDocument();
    expect(screen.queryByText(/Part 1 of/)).toBeNull();
    expect(screen.getByTestId("rubric-label")).toHaveTextContent("FICO 6-12 v1.2");
  });

  it("the dock says how many sections are left, and does not submit yet", async () => {
    renderPage();
    const dockBtn = await screen.findByRole("button", { name: "Submit (4 sections to finish)" }, { timeout: 8000 });
    fireEvent.click(dockBtn);
    expect(await screen.findByText(/items still to check/)).toBeInTheDocument();
    expect(screen.queryByTestId("fde-submit-tray")).toBeNull();
  });
});

describe("a section", () => {
  it("chips, title, n of m checked, one row per indicator with the level chip or Yours to set", async () => {
    const sec = await openSection(/^A\. /);
    expect(screen.getByTestId("ff-chips")).toBeInTheDocument();
    expect(within(screen.getByTestId("ff-chips")).getAllByRole("button")).toHaveLength(4);
    expect(within(sec).getByText("A. Lesson planning")).toBeInTheDocument();
    expect(within(sec).getByText("0 of 2 checked")).toBeInTheDocument();
    const rows = within(sec).getAllByTestId("ff-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("A1")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Lesson objective")).toBeInTheDocument();
    expect(within(rows[0]).getByText("3 · Proficient")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Two open questions; the rest were recall.")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Yours to set")).toBeInTheDocument();
  });

  it("the checks: their own Yes / No under the same head", async () => {
    const sec = await openSection(/^Checklist/);
    expect(within(sec).getByText("0 of 1 checked")).toBeInTheDocument();
    expect(within(sec).getByRole("radio", { name: "Yes" })).toBeInTheDocument();
  });
});

describe("one indicator", () => {
  it("Previous / code and name / Next; the line with the scoring note as its hint; the Digital Coach's level on its card", async () => {
    const ind = await openIndicator(/^A\. /, "A1");
    const nav = within(within(ind).getByTestId("ff-nav"));
    expect(nav.getByText("A1")).toBeInTheDocument();
    expect(nav.getByText("Lesson objective")).toBeInTheDocument();
    expect(within(ind).getByTestId("ff-about")).toHaveTextContent("What A1 looks at.");
    expect(within(ind).getByTestId("ff-hint")).toHaveTextContent("Scoring note for A1.");
    const card = within(within(ind).getByTestId("ff-card"));
    expect(card.getByTestId("legend")).toBeInTheDocument();
    const marked = card.getAllByRole("radio").filter((r) => r.textContent?.includes("Digital Coach"));
    expect(marked.map((r) => r.getAttribute("data-radio-key"))).toEqual(["3"]);
    expect(screen.queryByText(/chose 3/)).toBeNull();
    expect(within(screen.getByTestId("dc-evidence")).getByTestId("dc-summary")).toHaveTextContent("Two open questions");
    expect(screen.getByLabelText("Evidence")).toHaveValue(EV_A1);
  });

  it("Agree and next saves what changed (every answer, as today) and opens the next one still to check", async () => {
    await openIndicator(/^A\. /, "A1");
    fireEvent.change(screen.getByLabelText("Evidence"), { target: { value: `${EV_A1} Also a why question.` } });
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    await waitFor(() => expect(L.saveObs612Form).toHaveBeenCalled());
    expect(L.saveObs612Form.mock.calls[0][1]).toMatchObject({ A1: "3", ev_A1: `${EV_A1} Also a why question.` });
    expect(L.saveObs612Form.mock.calls[0][2]).toBe(false);
    const nav = await screen.findByTestId("ff-nav");
    await waitFor(() => expect(within(nav).getByText("A2")).toBeInTheDocument());
  });

  it("nothing changed: Agree and next moves on without a save, and the row turns green", async () => {
    await openIndicator(/^A\. /, "A1");
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    const nav = await screen.findByTestId("ff-nav");
    await waitFor(() => expect(within(nav).getByText("A2")).toBeInTheDocument());
    expect(L.saveObs612Form).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Back$|Back/ }));
    const rows = within(await screen.findByTestId("ff-section")).getAllByTestId("ff-row");
    expect(rows[0].querySelector("[data-mark]")).toHaveAttribute("data-mark", "done");
  });

  it("a starred one: its line in the Digital Coach's box, no card marked; a level is still needed", async () => {
    await openIndicator(/^A\. /, "A2");
    expect(within(screen.getByTestId("dc-evidence")).getByText(/never scores this one/)).toBeInTheDocument();
    expect(within(screen.getByTestId("ff-card")).getAllByRole("radio")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    // no level and no evidence yet: both are counted, the level marked first
    expect(await screen.findByText("2 items still need an answer")).toBeInTheDocument();
    expect(screen.getByText("Choose an answer")).toBeInTheDocument();
    expect(L.saveObs612Form).not.toHaveBeenCalled();
  });

  it("changed from the Digital Coach's level: Changed from … and Why you changed it; too short a reason is refused", async () => {
    await openIndicator(/^A\. /, "A1");
    fireEvent.click(within(screen.getByTestId("ff-card")).getByRole("radio", { name: /^2 · Developing/ }));
    expect(screen.getByText("Changed from 3 · Proficient")).toBeInTheDocument();
    const why = within(screen.getByTestId("why-changed")).getByLabelText("Why you changed it");
    fireEvent.change(why, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    expect(await screen.findByText("Write why you changed")).toBeInTheDocument();
    expect(L.saveObs612Form).not.toHaveBeenCalled();
  });

  it("could not set a level: its line in the Digital Coach's box, no card marked", async () => {
    await openIndicator(/^B\. /, "B1");
    expect(within(screen.getByTestId("dc-evidence")).getByText(/could not set a level/)).toBeInTheDocument();
    expect(within(screen.getByTestId("ff-card")).getAllByRole("radio").filter((r) => r.textContent?.includes("Digital Coach"))).toHaveLength(0);
  });
});

describe("submit", () => {
  it("every section green: Submit asks the bot, then the tray, then submits", async () => {
    localStorage.setItem("niete-fico-form-v7:cs-1", JSON.stringify({ checked: ["A1"], reviews: {}, at: Date.now() }));
    const full = { A1: "3", ev_A1: EV_A1, A2: "2", ev_A2: "Clear opening with a question to the class.", B1: "3", ev_B1: "Waited about five seconds each time.", cl_1: "yes", fb_strengths: "Good questions." };
    L.getObservationDraft.mockResolvedValue(DRAFT({ values: full }));
    L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...DRAFT({ values }) }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Submit" }, { timeout: 8000 }));
    expect(await screen.findByTestId("fde-submit-tray")).toBeInTheDocument();
  });
});

describe("switch off, or an older bot", () => {
  it("an older bot's draft (no section kind): today's part-by-part screen", async () => {
    const d = DRAFT();
    L.getObservationDraft.mockResolvedValue({ ...d, sections: d.sections.map(({ kind: _k, sec: _s, title: _t, code: _c, name: _n, starred: _st, ...rest }: any) => rest) });
    renderPage();
    expect(await screen.findByText(/Part 1 of/, undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByTestId("ff-sections")).toBeNull();
  });

  it("switch off: today's screen", async () => {
    flow.on = false;
    renderPage();
    await screen.findByTestId("coach-fde-form", undefined, { timeout: 8000 });
    expect(screen.queryByTestId("ff-sections")).toBeNull();
  });
});

describe("Urdu", () => {
  it("the sections and the dock in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    await screen.findByTestId("ff-sections", undefined, { timeout: 8000 });
    expect(screen.getByText(/جمع کرائیں|جمع کریں/)).toBeInTheDocument();
  });
});
