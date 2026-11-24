import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * Queue #251 (the operator 24 Nov ~10:25, on a production FICO 6-12 form: "when you click on the timestamp, it should show
 * you the recording part of it as well ... And second thing is the evidence is being repeated ... If we are looking at the
 * digital coach's evidence, then we only need to see that field. And then if we want to edit it ... you can have the
 * digital coach's evidence and then a free field for you to type in.") — the HITL Feedback Form, on the v6/v7 switch,
 * grades 1-5 (FICO17 v6) and 6-12 (FICO-S on the same pieces), coach and principal, English and Urdu:
 *
 *   the evidence    the Digital Coach's evidence ONCE (its line and each time + quote, read only). No pre-filled Evidence
 *                   box under it. "Edit evidence" opens an EMPTY "Your evidence" box under it (the Digital Coach's stays
 *                   above). Typed: her words are the evidence saved (and the report shows what she submitted). Left empty,
 *                   or "Keep the Digital Coach’s": the Digital Coach's evidence is kept, as today. 6-12: typed evidence
 *                   still needs 20 characters, with its counter and "Too short" reason. A form she saved with her own
 *                   words opens with them in the box.
 *   the time chip   tapping 04:30 plays the class recording from 04:30 right there: a player under the Digital Coach's
 *                   evidence (the kit's AudioCard: its bar shows where in the lesson it is); the quote stays.
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
const LESSON = "https://r2.example/lesson.webm";

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
const VIEW = { id: "cs-1", teacher: { name: "Lubna Arif", phone: "923001110001" }, report: { teacherName: "Lubna Arif" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };
const dcBox = () => screen.getByTestId("dc-evidence");
const urdu = async () => { await act(async () => { await i18n.changeLanguage("ur"); }); };

/* ── grades 6-12: FICO-S ───────────────────────────────────────────────────────────────────────────────────────── */

const LV = ["Below standard", "Developing", "Proficient", "Exemplary"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}`, description: `What level ${i + 1} looks like` }));
const item = (code: string, extra: Record<string, unknown> = {}) => ({
  type: "field", name: code, role: "item", input: "radio", kind: "level", n: null, short: `Section · ${code}`, text: `Look for ${code}`,
  options: LV, required: true, max: null, about: `What ${code} looks at.`, notes: `Scoring note for ${code}.`, ...extra,
});
const ev = (code: string, extra: Record<string, unknown> = {}) => ({ type: "field", name: `ev_${code}`, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Evidence: What you saw and heard", options: null, required: true, max: 600, ...extra });
const chg = (code: string) => ({ type: "field", name: `chg_${code}`, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Why you changed", options: null, required: false, max: 600 });
const BECAUSE_FS = "Students are asked to summarise the key learning and a homework is announced at the end.";
const QUOTE_FS = "اب آپ کے آتی ہے homework کی باری۔ آج کا آپ کا homework یہ ہے۔";
const DC_TEXT = `${BECAUSE_FS} [37:46] "${QUOTE_FS}"`; // what the Digital Coach pre-filled into ev_E4 (fico-s prefillEvidence)
const FS = (values: Record<string, string> = { E4: "3", ev_E4: DC_TEXT }, over: Record<string, unknown> = {}) => ({
  status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
  toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "FS_INTRO_E", kind: "intro", sec: "E", title: "Closing", parts: [{ type: "heading", text: "Section E · Closing" }] },
    { id: "FS_E_FOUR", kind: "indicator", sec: "E", code: "E4", name: "Summary and homework", starred: false, parts: [
      { type: "heading", text: "E4 · Summary and homework" },
      { type: "sub", text: "The Digital Coach chose 3 · Proficient from the recording.", dc: "chose" },
      item("E4", { dcLevel: "3", dcEvidence: { because: BECAUSE_FS, items: [{ time: "37:46", quote: QUOTE_FS }] } }),
      ev("E4", { dcText: DC_TEXT }), chg("E4"),
    ] },
    { id: "FS_E_FIVE", kind: "indicator", sec: "E", code: "E5", name: "Exit check", starred: false, parts: [
      { type: "heading", text: "E5 · Exit check" },
      item("E5"), ev("E5"),
    ] },
  ],
  values, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
  ...over,
});
const toE4 = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /^E\. Closing/ }, { timeout: 8000 }));
  const sec = await screen.findByTestId("ff-section");
  fireEvent.click(within(sec).getByRole("button", { name: /^E4\b/ }));
  return screen.findByTestId("ff-indicator");
};

describe("6-12: the Digital Coach's evidence once, and Edit evidence", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(FS()); });

  it("its evidence shows once: its line and the quote with its time; no pre-filled Evidence box; an Edit evidence action", async () => {
    await toE4();
    expect(within(dcBox()).getByText(BECAUSE_FS)).toBeInTheDocument();
    expect(within(dcBox()).getByText(`“${QUOTE_FS}”`)).toBeInTheDocument();
    expect(screen.queryByLabelText("Evidence")).toBeNull();
    expect(screen.queryByDisplayValue(DC_TEXT)).toBeNull();
    expect(screen.queryByLabelText("Your evidence")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit evidence" })).toBeInTheDocument();
    // its words are in the page once
    expect(screen.getAllByText(BECAUSE_FS, { exact: false })).toHaveLength(1);
  });

  it("Edit evidence: an empty box under it, the Digital Coach's evidence still above; typed words are what is saved", async () => {
    await toE4();
    fireEvent.click(screen.getByRole("button", { name: "Edit evidence" }));
    const box = screen.getByLabelText("Your evidence") as HTMLTextAreaElement;
    expect(box).toHaveValue("");
    expect(within(dcBox()).getByText(BECAUSE_FS)).toBeInTheDocument();
    // under the Digital Coach's box, in the page's order
    expect(dcBox().compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("char-count")).toHaveTextContent("0/20 characters");
    fireEvent.change(box, { target: { value: "Homework was copied from the book; no task applied the learning." } });
    expect(screen.getByTestId("char-count")).toHaveTextContent("64/20 characters");
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    await waitFor(() => expect(L.saveObs612Form).toHaveBeenCalledTimes(1));
    expect(L.saveObs612Form.mock.calls[0][1]).toMatchObject({ E4: "3", ev_E4: "Homework was copied from the book; no task applied the learning." });
  });

  it("opened but left empty: the Digital Coach's evidence is kept (nothing to save)", async () => {
    await toE4();
    fireEvent.click(screen.getByRole("button", { name: "Edit evidence" }));
    fireEvent.change(screen.getByLabelText("Your evidence"), { target: { value: "Some words" } });
    fireEvent.change(screen.getByLabelText("Your evidence"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    await waitFor(() => expect(screen.getByTestId("ff-indicator")).toHaveTextContent("Exit check"));
    expect(L.saveObs612Form).not.toHaveBeenCalled();
  });

  it("Keep the Digital Coach’s closes the box and drops what was typed", async () => {
    await toE4();
    fireEvent.click(screen.getByRole("button", { name: "Edit evidence" }));
    fireEvent.change(screen.getByLabelText("Your evidence"), { target: { value: "My own words about the homework." } });
    fireEvent.click(screen.getByRole("button", { name: "Keep the Digital Coach’s" }));
    expect(screen.queryByLabelText("Your evidence")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit evidence" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    await waitFor(() => expect(screen.getByTestId("ff-indicator")).toHaveTextContent("Exit check"));
    expect(L.saveObs612Form).not.toHaveBeenCalled();
  });

  it("typed evidence still needs 20 characters: the reason with the count, after leaving the box", async () => {
    await toE4();
    fireEvent.click(screen.getByRole("button", { name: "Edit evidence" }));
    const box = screen.getByLabelText("Your evidence");
    fireEvent.change(box, { target: { value: "Too brief." } });
    expect(screen.queryByText(/Too short/)).toBeNull();
    fireEvent.blur(box);
    expect(screen.getByText("Too short: at least 20 characters (10/20)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
    expect(L.saveObs612Form).not.toHaveBeenCalled();
    expect(screen.getByTestId("ff-indicator")).toHaveTextContent("Summary and homework");
  });

  it("saved before with her own words: they open in the box, under the Digital Coach's evidence", async () => {
    L.getObservationDraft.mockResolvedValue(FS({ E4: "2", ev_E4: "She set the homework but never linked it to the objective." }));
    await toE4();
    expect(screen.getByLabelText("Your evidence")).toHaveValue("She set the homework but never linked it to the objective.");
    expect(within(dcBox()).getByText(BECAUSE_FS)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit evidence" })).toBeNull();
  });

  it("an indicator without the Digital Coach's evidence keeps today's Evidence box", async () => {
    await toE4();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("ff-indicator")).toHaveTextContent("Exit check"));
    expect(screen.getByLabelText("Evidence")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit evidence" })).toBeNull();
  });

  it("an older bot (no dcText on the box): today's Evidence box, pre-filled, under the Digital Coach's evidence", async () => {
    const d = FS();
    (d.sections[1].parts[3] as any).dcText = undefined;
    L.getObservationDraft.mockResolvedValue(d);
    await toE4();
    expect(screen.getByLabelText("Evidence")).toHaveValue(DC_TEXT);
    expect(screen.queryByRole("button", { name: "Edit evidence" })).toBeNull();
  });

  it("read only: the Digital Coach's evidence once; her own words under it when she wrote them", async () => {
    L.getObservationDraft.mockResolvedValue(FS(undefined, { editable: false, sealed: true }));
    await toE4();
    expect(within(dcBox()).getByText(BECAUSE_FS)).toBeInTheDocument();
    expect(screen.queryByText(DC_TEXT)).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit evidence" })).toBeNull();
  });

  it("in Urdu: Edit evidence, Your evidence and Keep the Digital Coach’s in Urdu", async () => {
    await urdu();
    await toE4();
    fireEvent.click(await screen.findByRole("button", { name: "شواہد میں ترمیم کریں" }));
    expect(screen.getByLabelText("آپ کے شواہد")).toHaveValue("");
    expect(screen.getByRole("button", { name: "ڈیجیٹل کوچ کے شواہد رہنے دیں" })).toBeInTheDocument();
  });
});

describe("6-12: the time chip plays the class recording from there", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(FS()); });

  it("tap 37:46: a player under the Digital Coach's evidence, playing from 37:46; the quote stays", async () => {
    CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: LESSON });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    await toE4();
    expect(screen.queryByTestId("ff-player")).toBeNull();
    const chip = await within(dcBox()).findByRole("button", { name: "Play the lesson at 37:46" });
    fireEvent.click(chip);
    const player = await screen.findByTestId("ff-player");
    expect(dcBox().compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(player).getByText("Class recording")).toBeInTheDocument();
    expect(within(player).getByText("From 37:46")).toBeInTheDocument();
    const audio = player.querySelector("audio") as HTMLAudioElement;
    expect(audio).toHaveAttribute("src", LESSON);
    expect(play).toHaveBeenCalled();
    // the file's length arrives: it lands at 37:46 (2266 s)
    Object.defineProperty(audio, "duration", { configurable: true, value: 2700 });
    fireEvent(audio, new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(2266);
    expect(within(player).getByTestId("audio-time")).toHaveTextContent("37:46");
    expect(within(dcBox()).getByText(`“${QUOTE_FS}”`)).toBeInTheDocument();
    play.mockRestore();
  });

  it("no recording on the page: a plain chip, no player", async () => {
    CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: null });
    await toE4();
    await waitFor(() => expect(CO.getObservation).toHaveBeenCalled());
    expect(within(dcBox()).queryByRole("button", { name: /Play the lesson/ })).toBeNull();
    expect(within(dcBox()).getByTestId("ff-time")).toHaveTextContent("37:46");
  });
});

/* ── grades 1-5: FICO17 v6 ─────────────────────────────────────────────────────────────────────────────────────── */

const LEVELS4 = ["Not Observed", "Developing", "Proficient", "Highly Effective"];
const lv = () => LEVELS4.map((t, i) => ({ id: String(i + 1), title: t, description: `${t}: the rubric's words` }));
const BECAUSE = "Teacher mainly asks closed recall questions; one clear open prompt.";
const Q1 = "اب ہم کیا کریں گے؟ آپ کے گھر کے آگے پیچھے بھی جانور ہیں";
const Q2 = "بتائیں، بلی کی کتنی ٹانگیں ہوتی ہیں؟";
const SERVER_EV = `${BECAUSE} · 04:30 "${Q1}"`;
const MINE = "She asked two why questions and waited for answers.";
const C1 = (extra: Record<string, unknown> = {}) => ({
  id: "C1", field: "C1", name: "Quality of Questions Asked by the Teacher", kind: "dc", options: lv(), rumi: "3", rating: "3",
  evidence: SERVER_EV, rumiText: SERVER_EV, improvement: "Ask one why question after each answer.",
  rumiEvidence: { because: BECAUSE, items: [{ time: "04:30", quote: Q1 }, { time: "12:15", quote: Q2 }] },
  ...extra,
});
const V6 = (extra: Record<string, unknown> = {}, c1: Record<string, unknown> = {}) => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [{ id: "executed", title: "✓ Executed" }],
  sections: [
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [
        C1(c1),
        { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv(), body: "Who answered.", rating: "", why: "",
          recording: { lookFor: "Who answered.", state: "found", found: [{ time: "09:05", quote: "Ali, you answer." }], naText: null, turns: null, youAdd: "" } },
      ] },
  ],
  ...extra,
});
const toC1 = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: /C\. What the teacher does/ }));
  const sec = await screen.findByTestId("ff-section");
  fireEvent.click(within(sec).getByRole("button", { name: /^C1\b/ }));
  return screen.findByTestId("ff-indicator");
};
const saveAll = async () => {
  // C1 agreed, C3 set, then Save → the tray → Save and continue
  fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
  await waitFor(() => expect(screen.getByTestId("ff-indicator")).toHaveTextContent("Who got to answer"));
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Who got to answer" })).getByRole("radio", { name: /Developing/ }));
  fireEvent.click(screen.getByRole("button", { name: "Agree and next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Done" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save and continue" }));
  await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(1));
  return L.saveObservationDraft.mock.calls[0];
};

describe("1-5: the Digital Coach's evidence once, and Edit evidence", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(V6()); });

  it("its line and every quote with its time, read only; no ⋯ menus, pencil or Add evidence; an Edit evidence action", async () => {
    await toC1();
    expect(within(dcBox()).getByText(BECAUSE)).toBeInTheDocument();
    expect(within(dcBox()).getByText(`“${Q1}”`)).toBeInTheDocument();
    expect(within(dcBox()).getByText(`“${Q2}”`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More: edit or remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit the summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add evidence" })).toBeNull();
    expect(screen.queryByLabelText("Evidence")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit evidence" })).toBeInTheDocument();
  });

  it("typed in Your evidence: her words are ev_C1; the record keeps the Digital Coach's quotes and adds hers", async () => {
    await toC1();
    fireEvent.click(screen.getByRole("button", { name: "Edit evidence" }));
    const box = screen.getByLabelText("Your evidence");
    expect(box).toHaveValue("");
    fireEvent.change(box, { target: { value: MINE } });
    const [id, edits, review] = await saveAll();
    expect(id).toBe("cs-1");
    expect(edits.ev_C1).toBe(MINE);
    expect(review.C1).toEqual({
      summary: { rumi: BECAUSE, coach: BECAUSE },
      items: [
        { source: "rumi", time: "04:30", quote: Q1, status: "kept" },
        { source: "rumi", time: "12:15", quote: Q2, status: "kept" },
        { source: "coach", time: null, text: MINE },
      ],
    });
  });

  it("not typed: the Digital Coach's evidence is kept as today (the server's own ev_ text, every quote kept)", async () => {
    await toC1();
    fireEvent.click(screen.getByRole("button", { name: "Edit evidence" }));
    const [, edits, review] = await saveAll();
    expect(edits.ev_C1).toBe(SERVER_EV);
    expect(review.C1.items.map((i: any) => i.status)).toEqual(["kept", "kept"]);
  });

  it("saved before with her own words: they open in the box", async () => {
    L.getObservationDraft.mockResolvedValue(V6({ saved: true }, {
      evidence: MINE,
      evidenceReview: { summary: { rumi: BECAUSE, coach: BECAUSE }, items: [
        { source: "rumi", time: "04:30", quote: Q1, status: "kept" }, { source: "rumi", time: "12:15", quote: Q2, status: "kept" },
        { source: "coach", time: null, text: MINE }] },
    }));
    await toC1();
    expect(screen.getByLabelText("Your evidence")).toHaveValue(MINE);
    expect(within(dcBox()).getByText(BECAUSE)).toBeInTheDocument();
    expect(screen.queryByText(`“${MINE}”`)).toBeNull();
  });

  it("the principal: the same", async () => {
    render(
      <ObserveRoutesProvider value={{ ...COACH_OBSERVE_ROUTES, coachGate: false, showScores: false }}>
        <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
          <Routes><Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} /></Routes>
        </MemoryRouter>
      </ObserveRoutesProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /C\. What the teacher does/ }));
    fireEvent.click(within(await screen.findByTestId("ff-section")).getByRole("button", { name: /^C1\b/ }));
    await screen.findByTestId("ff-indicator");
    expect(within(dcBox()).getByText(BECAUSE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit evidence" })).toBeInTheDocument();
  });

  it("in Urdu", async () => {
    await urdu();
    await toC1();
    fireEvent.click(await screen.findByRole("button", { name: "شواہد میں ترمیم کریں" }));
    expect(screen.getByLabelText("آپ کے شواہد")).toHaveValue("");
  });
});

describe("1-5: the time chip plays the class recording from there", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(V6()); });

  it("one of the eleven: tap 12:15, a player under the evidence from 12:15; a second chip moves it", async () => {
    CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: LESSON });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    await toC1();
    fireEvent.click(await within(dcBox()).findByRole("button", { name: "Play the lesson at 12:15" }));
    const player = await screen.findByTestId("ff-player");
    expect(dcBox().compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(player).getByText("From 12:15")).toBeInTheDocument();
    const audio = player.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 2400 });
    fireEvent(audio, new Event("loadedmetadata"));
    expect(audio.currentTime).toBe(735);
    fireEvent.click(within(dcBox()).getByRole("button", { name: "Play the lesson at 04:30" }));
    expect(audio.currentTime).toBe(270);
    expect(within(screen.getByTestId("ff-player")).getByText("From 04:30")).toBeInTheDocument();
    expect(play).toHaveBeenCalled();
    play.mockRestore();
  });

  it("one of the six: its found moment plays the same way", async () => {
    CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: LESSON });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    await toC1();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("ff-indicator")).toHaveTextContent("Who got to answer"));
    fireEvent.click(await within(dcBox()).findByRole("button", { name: "Play the lesson at 09:05" }));
    expect(within(await screen.findByTestId("ff-player")).getByText("From 09:05")).toBeInTheDocument();
    play.mockRestore();
  });

  it("moving to another indicator closes the player", async () => {
    CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: LESSON });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    await toC1();
    fireEvent.click(await within(dcBox()).findByRole("button", { name: "Play the lesson at 04:30" }));
    await screen.findByTestId("ff-player");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("ff-indicator")).toHaveTextContent("Who got to answer"));
    expect(screen.queryByTestId("ff-player")).toBeNull();
    play.mockRestore();
  });
});

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  CO.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
  CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: null });
  L.saveObservationDraft.mockResolvedValue({ success: true });
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...FS(values) }));
});
afterEach(() => { vi.useRealTimers(); });
