import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.47 (queue #243; the operator 23 Nov ~23:23: "On the observation page when the form has been filled, it is
 * just there on this page as a whole. Pushes the next stuff all the way down.") — on the v6/v7 switch, coach and
 * principal, grades 1-5 and 6-12, English and Urdu:
 *   1. the next step comes first: a "Next: <step>" card right under the header, with its button(s);
 *   2. the filled form is ONE summary card: "Form filled", the result line (52 / 88 · 59.1% · Developing) and View form
 *      (a 6-12 / FDE form expands in place, read-only; a 1-5 form opens its page);
 *   3. the class recording is one compact row (the bar, ±10 s and the speed appear once she plays it);
 *   4. later stages collapse the same way, the newest on top: the report sent, the debrief, the form, the recording.
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
import { getCoachReport, type CoachReport } from "../report/api";
import CoachObservation from "../pages/CoachObservation";
import { ObserveRoutesProvider } from "../observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "../../teacher/principal/observe";
import type { Obs612Summary } from "../../lib/obs612";

const C = coach as unknown as { getObservation: Mock };
const L = leader as unknown as { getObservation: Mock };
const R = getCoachReport as unknown as Mock;

const LESSON_URL = "https://r2.example/lesson.webm?sig=1";
const TALK_URL = "https://r2.example/talk.webm?sig=1";

// The operator's screenshot: a FICO 6-12 visit, the form filled.
const FICOS: Obs612Summary = {
  label: "FICO-S v1.1", rubric: "fico_s_v1_1", tool: "ficos", toolName: "FICO 6-12", toolTitle: "FICO 6-12", grade: 7, subject: "english",
  result: "52 / 88 · 59.1% · Developing", noTotal: false, headline: "52 / 88 · 59.1% · Developing",
  rows: [
    { name: "A · Lesson planning & structure", value: "3.0 / 4", pct: 75 },
    { name: "A1 · Lesson objective (SLO)", value: "2 · Developing", pct: null, note: "Teacher stated the topic but no measurable objective. [06:04]" },
  ],
  feedback: [], footer: "FICO-S v1.1 · grades 6-12",
};

const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-1", date: "2026-11-19T05:30:00Z", step: "talk", portal: true, mine: true, score: null, dcScore: 64,
  summary: null, teacher: { name: "Lubna Arif", teacherExtId: "923001110001", schoolName: "IMSG (I-V) G-7/3" },
  observer: { self: true, name: "Hina" }, sentAt: null, caption: null, imageUrl: null, audioUrl: LESSON_URL, obs612: null, ...extra,
});
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-11-19T05:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Lubna Arif", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: { intro: "Start with a win.", steps: [] }, recordedAt: ["report", "sending", "sent", "done"].includes(step) ? "2026-11-19T09:00:00Z" : null,
    audioUrl: ["report", "sending", "sent", "done"].includes(step) ? TALK_URL : null,
    feedback: ["feedback", "report", "sending", "sent", "done"].includes(step) ? { harmful: false } : null },
  report: { status: null, teacherName: "Lubna Arif", teacherPhone: "923001110001", caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});
const FICOS_RUBRIC = { rubric: { id: "fico_s_v1_1", label: "FICO-S v1.1" } };
const both = (en: string) => ({ en, ur: `${en}-ur` });
const REPORT: CoachReport = {
  id: "cs-1",
  header: { teacher: "Lubna Arif", grade: "3", subject: "Urdu", topic: null, at: "2026-11-19T05:30:00Z" },
  harmful: false, concern: null,
  marks: ["asked", "moves", "rehearsed", "praise", "moment", "one", "own", "less"].map((k, i) => ({ key: k, done: i === 0 || i === 2 || i === 7, name: both(k) })),
  done: 3, total: 8, respectHeld: true, did: [], missed: [],
  focus: { key: "own", move: "m", why: "w", tryLine: { en: "t", ur: "t" } },
};

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  R.mockResolvedValue(REPORT);
});

function renderVisit(principal = false) {
  const page = <CoachObservation />;
  return render(
    <MemoryRouter initialEntries={["/o/cs-1"]}>
      <Routes>
        <Route path="/o/:id" element={principal ? <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>{page}</ObserveRoutesProvider> : page} />
      </Routes>
    </MemoryRouter>,
  );
}

/** a comes before b in the page. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const itemOrder = () => Array.from(screen.getByTestId("visit-items").querySelectorAll("[data-item]")).map((n) => n.getAttribute("data-item"));

describe("6-12, the form filled, the debrief next (the operator's screenshot)", () => {
  async function open() {
    C.getObservation.mockResolvedValue(OBS({ step: "talk", obs612: FICOS }));
    L.getObservation.mockResolvedValue(VIEW("talk", FICOS_RUBRIC));
    renderVisit();
    return screen.findByTestId("visit-next", {}, { timeout: 8000 });
  }

  it("the next step comes first: Next: Record the debrief, with its due day and both buttons", async () => {
    const next = await open();
    expect(next).toHaveTextContent("Next: Record the debrief");
    expect(within(next).getByTestId("debrief-due")).toHaveTextContent(/due (by )?Mon 23 Nov/i); // "Was due" once that day has passed
    expect(within(next).getByRole("link", { name: /Start recording/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief");
    expect(within(next).getByRole("link", { name: /Upload recording/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief?upload=1");
    // nothing of the visit sits above it: the form, the recording and the line all come after
    for (const id of ["status-line", "class-recording"]) expect(before(next, screen.getByTestId(id))).toBe(true);
    expect(before(next, screen.getByTestId("visit-form"))).toBe(true);
  });

  it("the status line under it does not say the same step again", async () => {
    await open();
    const line = screen.getByTestId("status-line");
    expect(line).not.toHaveTextContent("Now: Record the debrief");
    expect(within(line).getAllByTestId("status-label").map((s) => s.textContent)).toEqual(["Analysed", "Form filled", "Record the debrief", "Yet to send"]);
  });

  it("the filled form is ONE summary card: Form filled · 52 / 88 · 59.1% · Developing, and View form", async () => {
    await open();
    const card = screen.getByTestId("visit-form");
    expect(card).toHaveTextContent("Form filled");
    expect(card).toHaveTextContent("52 / 88 · 59.1% · Developing");
    // collapsed: no section bars, no indicators, no evidence
    expect(screen.queryByTestId("obs612")).toBeNull();
    expect(screen.queryByTestId("obs612-row")).toBeNull();
    expect(screen.queryByText(/Teacher stated the topic/)).toBeNull();
    const view = within(card).getByRole("button", { name: "View form" });
    expect(view).toHaveAttribute("aria-expanded", "false");
  });

  it("View form opens the whole form in place, read-only; Hide form folds it again", async () => {
    await open();
    const card = screen.getByTestId("visit-form");
    fireEvent.click(within(card).getByRole("button", { name: "View form" }));
    const block = within(card).getByTestId("obs612");
    expect(within(block).getAllByTestId("obs612-row")).toHaveLength(2);
    expect(block).toHaveTextContent("Teacher stated the topic");
    expect(block.querySelector("input, textarea, select")).toBeNull();
    const hide = within(card).getByRole("button", { name: "Hide form" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(hide);
    expect(screen.queryByTestId("obs612")).toBeNull();
  });

  it("the class recording is one compact row under the form; its bar and speed appear once she plays it", async () => {
    await open();
    const form = screen.getByTestId("visit-form");
    const rec = screen.getByTestId("class-recording");
    expect(before(form, rec)).toBe(true);
    expect(rec).toHaveTextContent("Class recording");
    expect(within(rec).queryByRole("slider")).toBeNull();
    expect(within(rec).queryByRole("button", { name: "Forward 10 s" })).toBeNull();
    expect((rec.querySelector("audio") as HTMLAudioElement).getAttribute("src")).toBe(LESSON_URL);
    fireEvent.click(within(rec).getByRole("button", { name: "Play" }));
    expect(within(rec).getByRole("slider", { name: "Position" })).toBeInTheDocument();
    expect(within(rec).getByRole("button", { name: "Forward 10 s" })).toBeInTheDocument();
  });

  it("Urdu: اگلا (the form's own Next word), فارم دیکھیں; the result stays left-to-right", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    const next = await open();
    expect(next).toHaveTextContent("اگلا: ڈی بریف ریکارڈ کریں");
    const card = screen.getByTestId("visit-form");
    expect(card).toHaveTextContent("فارم بھر دیا");
    expect(within(card).getByTestId("visit-form-result")).toHaveAttribute("dir", "ltr");
    expect(within(card).getByRole("button", { name: "فارم دیکھیں" })).toBeInTheDocument();
  });
});

describe("1-5 (FICO17), the form filled", () => {
  it("the form card carries the score and opens the form's page; the recording is its own compact row", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "talk", dcScore: 64 }));
    L.getObservation.mockResolvedValue(VIEW("talk"));
    renderVisit();
    const next = await screen.findByTestId("visit-next", {}, { timeout: 8000 });
    const card = screen.getByTestId("visit-form");
    expect(before(next, card)).toBe(true);
    expect(card).toHaveTextContent("Form filled");
    expect(card).toHaveTextContent("64%");
    expect(within(card).getByRole("link", { name: /View form/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/form");
    const rec = screen.getByTestId("class-recording");
    expect(before(card, rec)).toBe(true);
    expect(rec).toHaveTextContent("Class recording");
    expect(within(rec).queryByRole("slider")).toBeNull();
  });

  it("the form still to fill: Next: Fill the form first; no Form filled card", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "draft" }));
    L.getObservation.mockResolvedValue(VIEW("draft", { talk: { guide: null, recordedAt: null, feedback: null } }));
    renderVisit();
    const next = await screen.findByTestId("visit-next", {}, { timeout: 8000 });
    expect(next).toHaveTextContent("Next: Fill the form");
    expect(within(next).getByRole("link", { name: /Fill the Feedback Form/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/form");
    expect(screen.queryByTestId("visit-form")).toBeNull();
    expect(before(next, screen.getByTestId("class-recording"))).toBe(true);
  });
});

describe("later stages collapse the same way, the newest on top", () => {
  it("send next: Next: Send Lubna the report; then the debrief (report, recording), the form, the class recording", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report", obs612: FICOS }));
    L.getObservation.mockResolvedValue(VIEW("report", FICOS_RUBRIC));
    renderVisit();
    const next = await screen.findByTestId("visit-next", {}, { timeout: 8000 });
    expect(next).toHaveTextContent("Next: Send Lubna the report");
    expect(next).toHaveTextContent("Lubna gets it on WhatsApp.");
    expect(within(next).getByRole("link", { name: /Send report/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/send");
    await waitFor(() => expect(screen.getByTestId("visit-feedback")).toHaveTextContent("38%"));
    expect(itemOrder()).toEqual(["debrief-report", "debrief", "debrief-recording", "form", "class-recording"]);
    // the debrief collapsed to one row, opening its page
    const debrief = screen.getByTestId("visit-debrief");
    expect(debrief).toHaveTextContent("Debriefed");
    expect(within(debrief).getByRole("link", { name: /View debrief/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief");
    // the debrief recording is a compact row too
    expect(within(screen.getByTestId("debrief-recording")).queryByRole("slider")).toBeNull();
    expect(before(next, screen.getByTestId("visit-items"))).toBe(true);
  });

  it("sent: no Next card; the report sent is on top, folded to one row; View report opens it in place", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "sent", obs612: FICOS, imageUrl: "https://r2.example/report.png", caption: "Well done", sentAt: "2026-11-19T10:00:00Z" }));
    L.getObservation.mockResolvedValue(VIEW("sent", { ...FICOS_RUBRIC, report: { ...VIEW("sent").report, status: "sent", imageUrl: "https://r2.example/report.png", sentAt: "2026-11-19T10:00:00Z" } }));
    renderVisit();
    const items = await screen.findByTestId("visit-items", {}, { timeout: 8000 });
    await waitFor(() => expect(items.querySelector('[data-item="teacher-report"]')).not.toBeNull());
    expect(screen.queryByTestId("visit-next")).toBeNull();
    expect(itemOrder()[0]).toBe("teacher-report");
    expect(itemOrder().slice(-2)).toEqual(["form", "class-recording"]);
    const sent = screen.getByTestId("observation-report");
    expect(sent).toHaveTextContent("Report sent to Lubna");
    expect(sent.querySelector("img")).toBeNull();
    expect(sent).not.toHaveTextContent("Well done");
    fireEvent.click(within(sent).getByRole("button", { name: "View report" }));
    expect(within(sent).getByRole("button", { name: /Open full screen/ })).toBeInTheDocument();
    expect(sent).toHaveTextContent("Well done");
  });
});

describe("the principal: the same order, no scores", () => {
  it("Next first; the form card says Form filled with no numbers and opens the principal's form page", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "talk", obs612: FICOS }));
    L.getObservation.mockResolvedValue(VIEW("talk", FICOS_RUBRIC));
    renderVisit(true);
    const next = await screen.findByTestId("visit-next", {}, { timeout: 8000 });
    expect(next).toHaveTextContent("Next: Record the debrief");
    const card = screen.getByTestId("visit-form");
    expect(before(next, card)).toBe(true);
    expect(card).toHaveTextContent("Form filled");
    expect(card).not.toHaveTextContent("52 / 88");
    expect(card.textContent).not.toMatch(/\d+%/);
    expect(within(card).getByRole("link", { name: /View form/ })).toHaveAttribute("href", "/portal/teacher/principal/observation/cs-1/form");
    expect(screen.queryByTestId("obs612")).toBeNull();
    const rec = screen.getByTestId("class-recording");
    expect(before(card, rec)).toBe(true);
    expect(within(rec).queryByRole("slider")).toBeNull();
  });
});

describe("switch off: the page as on production", () => {
  it("the full form inline, no Next card, no summary card", async () => {
    flow.on = false;
    C.getObservation.mockResolvedValue(OBS({ step: "talk", obs612: FICOS }));
    L.getObservation.mockResolvedValue(VIEW("talk", FICOS_RUBRIC));
    renderVisit();
    await screen.findByTestId("obs612", {}, { timeout: 8000 });
    expect(screen.queryByTestId("visit-next")).toBeNull();
    expect(screen.queryByTestId("visit-form")).toBeNull();
  });
});
