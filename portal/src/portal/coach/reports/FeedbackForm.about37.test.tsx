import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";
import type { ReactNode } from "react";

/**
 * bd-o15qnr.37 (queue #204; the operator 22 Nov ~00:15: "On the page of a single indicator, isn't there a gap that there
 * is no description of the indicator?") — on every Feedback Form indicator page, on the switch, coach and principal,
 * FICO17 v6.1 and FICO-S v1.2, English and Urdu:
 *
 *   under the name   one plain line on what the indicator looks at (the bot's `about`: #217's guide line), muted, two
 *                    lines at most ("ff-about")
 *   Examples         a small link that opens that indicator in the "?" guide, shown only when the guide has it
 *                    (IndicatorGuideContext, which #217 provides; until then no link)
 *   the six          the line is not said again inside "From the recording"
 *   FICO-S           the card no longer repeats the look-for text: it keeps the notes (scoring note, How)
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
import { IndicatorGuideContext, type IndicatorGuide } from "./indicatorGuide";

const L = leader as any;
const CO = coach as any;

const LEVELS4 = ["Not Observed", "Developing", "Proficient", "Highly Effective"];
const lv = () => LEVELS4.map((t, i) => ({ id: String(i + 1), title: t, description: `${t}: the rubric's words` }));
const C1_ABOUT = "The kinds of questions the teacher asks, and whether they make children think.";
const C1_ABOUT_UR = "استاد کس طرح کے سوال پوچھتا ہے، اور کیا وہ بچوں کو سوچنے پر لگاتے ہیں۔";
const C3_ABOUT = "How the teacher chooses who answers: only hands up and call-outs, or ways of bringing in other children.";
const C3_LOOK = "How the teacher chooses who answers: only children who put a hand up or call out, or ways of bringing in other children.";
const rec = (over: Record<string, unknown> = {}) => ({ lookFor: C3_LOOK, state: "none", found: [], naText: null, turns: null, youAdd: "who spoke.", ...over });

const V6 = (opts: { about?: boolean; ur?: boolean } = {}) => {
  const about = opts.about !== false;
  return {
    kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6.1" },
    scale: [], fidelityScale: [], notes: [],
    sections: [
      { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
        indicators: [
          { id: "C1", field: "C1", name: "Quality of Questions Asked by the Teacher", kind: "dc", options: lv(), rumi: "3", rating: "3",
            evidence: "Two open questions.", improvement: "", rumiEvidence: { because: "Two open questions.", items: [] },
            ...(about ? { about: opts.ur ? C1_ABOUT_UR : C1_ABOUT } : {}) },
          { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv(), body: `${C3_LOOK}\n\nThe recording showed nothing for this.`,
            rating: "", why: "", recording: rec(), ...(about ? { about: C3_ABOUT } : {}) },
        ] },
    ],
  };
};

const ficoItem = (code: string, short: string, extra: Record<string, unknown> = {}) => ({
  type: "field", name: code, role: "item", input: "radio", kind: "level", n: null, short,
  text: `Look for ${code}: the rubric's long look-for words.\n\nA scoring note.\nHow: In class`,
  options: lv(), required: true, max: null, ...extra,
});
const ev = (name: string) => ({ type: "field", name, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Evidence", options: null, required: true, max: 600 });
const FICOS = (opts: { about?: boolean } = {}) => {
  const about = opts.about !== false;
  return {
    status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
    toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
    sections: [
      { id: "FS_C1", parts: [
        { type: "heading", text: "C1 · Quality of questions" },
        ficoItem("C1", "Section C · 1 of 8", about ? { about: "What kinds of questions the teacher asks and whether they make students think.", notes: "A scoring note.\nHow: In class" } : {}),
        ev("ev_C1"),
      ] },
    ],
    values: {}, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
  };
};

const VIEW = { id: "cs-1", teacher: { name: "Lubna Arif", phone: "923001110001" }, report: { teacherName: "Lubna Arif" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };
const PRINCIPAL = { ...COACH_OBSERVE_ROUTES, coachGate: false, showScores: false };

const renderPage = (opts: { principal?: boolean; guide?: IndicatorGuide | null } = {}) => {
  const tree: ReactNode = (
    <ObserveRoutesProvider value={opts.principal ? PRINCIPAL : COACH_OBSERVE_ROUTES}>
      <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
        <Routes>
          <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
          <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
        </Routes>
      </MemoryRouter>
    </ObserveRoutesProvider>
  );
  return render(opts.guide ? <IndicatorGuideContext.Provider value={opts.guide}>{tree}</IndicatorGuideContext.Provider> : tree);
};
const toV6 = async (code: string, opts: { principal?: boolean; guide?: IndicatorGuide | null } = {}) => {
  renderPage(opts);
  fireEvent.click(await screen.findByRole("button", { name: /C\. What the teacher does/ }));
  await screen.findByTestId("ff-section");
  fireEvent.click(within(screen.getByTestId("ff-section")).getByRole("button", { name: new RegExp(`^${code}\\b`) }));
  return screen.findByTestId("ff-indicator");
};
const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const guideFor = (codes: string[]) => ({ has: vi.fn((_r: string, c: string) => codes.includes(c)), open: vi.fn() });

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(V6());
  L.saveObservationDraft.mockResolvedValue({ success: true });
  CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: null });
});

describe("FICO17 v6.1: the line under the name", () => {
  it("one muted line, two lines at most, between the name row and the card; no Examples link without the guide", async () => {
    await toV6("C1");
    const about = screen.getByTestId("ff-about");
    const line = within(about).getByText(C1_ABOUT);
    expect(line.className).toMatch(/line-clamp-2/);
    expect(line.className).toMatch(/text-\[#6b7280\]/);
    expect(line).toHaveAttribute("dir", "auto");
    expect(after(screen.getByTestId("ff-nav"), about)).toBe(true);
    expect(after(about, screen.getByTestId("ff-card"))).toBe(true);
    expect(screen.queryByRole("button", { name: /Examples/ })).toBeNull();
  });

  it("Examples shows once the guide has the indicator, and opens it there", async () => {
    const guide = guideFor(["C1"]);
    await toV6("C1", { guide });
    const link = within(screen.getByTestId("ff-about")).getByRole("button", { name: "Examples" });
    fireEvent.click(link);
    expect(guide.open).toHaveBeenCalledWith("fico17_v6", "C1");
  });

  it("a guide without that indicator: still no link", async () => {
    await toV6("C1", { guide: guideFor(["C2"]) });
    expect(screen.queryByRole("button", { name: "Examples" })).toBeNull();
  });

  it("one of the six: the line under the name, not again in From the recording", async () => {
    await toV6("C3");
    expect(within(screen.getByTestId("ff-about")).getByText(C3_ABOUT)).toBeInTheDocument();
    const box = screen.getByTestId("from-recording");
    expect(box).not.toHaveTextContent(C3_LOOK);
    expect(box).toHaveTextContent("Nothing for this in the recording");
  });

  it("an older bot (no line): nothing under the name, and the box keeps what to look for", async () => {
    L.getObservationDraft.mockResolvedValue(V6({ about: false }));
    await toV6("C3");
    expect(screen.queryByTestId("ff-about")).toBeNull();
    expect(screen.getByTestId("from-recording")).toHaveTextContent(C3_LOOK);
  });

  it("the principal: the same line", async () => {
    await toV6("C1", { principal: true });
    expect(within(screen.getByTestId("ff-about")).getByText(C1_ABOUT)).toBeInTheDocument();
  });

  it("Urdu: the Urdu line, and مثالیں once the guide has it", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObservationDraft.mockResolvedValue(V6({ ur: true }));
    await toV6("C1", { guide: guideFor(["C1"]) });
    const about = within(screen.getByTestId("ff-about"));
    expect(about.getByText(C1_ABOUT_UR)).toBeInTheDocument();
    expect(about.getByRole("button", { name: "مثالیں" })).toBeInTheDocument();
  });
});

describe("FICO-S v1.2: the line under the name", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(FICOS()); });

  it("the line right under the indicator's name; the card keeps the notes, not the look-for again", async () => {
    renderPage();
    const heading = await screen.findByText("C1 · Quality of questions");
    const about = screen.getByTestId("ff-about");
    const line = within(about).getByText("What kinds of questions the teacher asks and whether they make students think.");
    expect(line.className).toMatch(/line-clamp-2/);
    expect(after(heading, about)).toBe(true);
    const card = screen.getByTestId("fde-item");
    expect(after(about, card)).toBe(true);
    expect(card).not.toHaveTextContent("Look for C1");
    expect(card).toHaveTextContent("A scoring note.");
    expect(card).toHaveTextContent("How: In class");
    expect(screen.queryByRole("button", { name: "Examples" })).toBeNull();
  });

  it("Examples opens the FICO-S indicator in the guide", async () => {
    const guide = guideFor(["C1"]);
    renderPage({ guide });
    await screen.findByText("C1 · Quality of questions");
    fireEvent.click(within(screen.getByTestId("ff-about")).getByRole("button", { name: "Examples" }));
    expect(guide.open).toHaveBeenCalledWith("fico_s_v1_2", "C1");
  });

  it("the principal: the same", async () => {
    renderPage({ principal: true });
    await screen.findByText("C1 · Quality of questions");
    expect(screen.getByTestId("ff-about")).toBeInTheDocument();
  });

  it("an older bot (no line): the card as today", async () => {
    L.getObservationDraft.mockResolvedValue(FICOS({ about: false }));
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    expect(screen.queryByTestId("ff-about")).toBeNull();
    expect(screen.getByTestId("fde-item")).toHaveTextContent("Look for C1");
  });

  it("off the switch: the form as today", async () => {
    flow.on = false;
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    expect(screen.queryByTestId("ff-about")).toBeNull();
    expect(screen.getByTestId("fde-item")).toHaveTextContent("Look for C1");
  });
});
