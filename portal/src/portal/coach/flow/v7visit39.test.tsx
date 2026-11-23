import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.39 (queue #204; the operator 22 Nov ~00:40-00:50) — on the v6/v7 switch, coach and principal:
 *   - "I don't think the 'What you made' heading is needed. Just show all the submitted items like class recording, debrief
 *     recording, debrief report, attached lessons etc here." The visit lists every item in order, each opening or playing
 *     in place: class recording (player), lesson plan, Feedback Form, the debrief, the debrief recording (player), the
 *     debrief report (its top card), the report the teacher was sent.
 *   - "Like the class recording, the debrief recording should also be attached to play right there." + "both these audios
 *     should be skippable and 2x able": both players have the bar, ±10 s and the speed.
 *   - While the Digital Coach listens to the debrief: the line says "Debrief: analysing" (on the visit and on every list
 *     card), and the visit says so, with how long it takes.
 */
/**
 * (v7.test.tsx's fixtures) bd-o15qnr.28 (queue #204, v7; the operator 20 Nov ~22:08: "just get it live asap") — #188's canvas page v7, LOCK round,
 * behind the v6/v7 switch (useFlowV6: a coach on portal_coach_flow_v2, or a principal on the principal app it names).
 *
 *   status line (option A)   words say whether a step happened: Analysed / Form filled / Debriefed / Sent (done),
 *                            Fill the form / Record the debrief / Send the report (current, half orange), Form to fill /
 *                            Debrief to do / Yet to send (later); "Now: <current>" replaces "Step n of 4"
 *   debrief due              3 school days after the visit (Sunday off): a Thursday visit is due by Monday
 *   the visit                the current step's card ON the visit: Your debrief (record / upload); the feedback card
 *                            (the report's own top card: %, stars, teacher) opening the ONE feedback page; Send the report
 *   the feedback page        coach "Your debrief report", principal "Your feedback": % of behaviours seen (3 of 8 = 38%)
 *                            with one 5-star row; Key Focus Area right under it; Your 8 behaviours with Respect held first
 *                            ("required"), seen first; well and missed 2 shown, then "Show N more"; the principal's
 *                            ending "The choice is yours."
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../training/appReady", async (orig) => ({ ...(await orig<Record<string, unknown>>()), coachFeatureReady: () => true }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, coach: { getObservation: vi.fn() }, leader: { getObservation: vi.fn() } }));
vi.mock("../report/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getCoachReport: vi.fn(), markOpened: vi.fn(async () => {}) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { coach, leader } from "../../services/api";
import { getCoachReport, type CoachReport } from "../report/api";
import CoachObservation from "../pages/CoachObservation";
import { ObserveRoutesProvider } from "../observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "../../teacher/principal/observe";
import { ReportSegments } from "../reports/ReportRows";

const C = coach as any;
const L = leader as any;
const R = getCoachReport as any;

const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-1", date: "2026-11-19T05:30:00Z", step: "talk", portal: true, mine: true, score: null, dcScore: 64,
  summary: null, teacher: { name: "Lubna Arif", teacherExtId: "923001110001", schoolName: "IMSG (I-V) G-7/3" },
  observer: { self: true, name: "Hina" }, sentAt: null, caption: null, imageUrl: null, audioUrl: null, ...extra,
});
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-11-19T05:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Lubna Arif", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: { intro: "Start with a win.", steps: [] }, recordedAt: ["report", "sending", "sent", "done"].includes(step) ? "2026-11-19T09:00:00Z" : null,
    feedback: ["feedback", "report", "sending", "sent", "done"].includes(step) ? { harmful: false } : null },
  report: { status: null, teacherName: "Lubna Arif", teacherPhone: "923001110001", caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});
const both = (en: string) => ({ en, ur: `${en}-ur` });
const REPORT: CoachReport = {
  id: "cs-1",
  header: { teacher: "Lubna Arif", grade: "3", subject: "Urdu", topic: null, at: "2026-11-19T05:30:00Z" },
  harmful: false, concern: null,
  marks: ["asked", "moves", "rehearsed", "praise", "moment", "one", "own", "less"].map((k, i) => ({ key: k, done: [1, 4, 0].includes(i) ? false : i < 3, name: both(k) }))
    .map((m, i) => ({ ...m, done: i === 0 || i === 2 || i === 7 })),
  done: 3, total: 8, respectHeld: true,
  did: [{ key: "asked", name: both("Asked & waited"), line: "You asked and waited." }, { key: "rehearsed", name: both("Rehearsed aloud"), line: "Roleplay." },
    { key: "less", name: both("Talked less"), line: "You let them talk." }],
  missed: ["praise", "moment", "one", "own", "moves"].map((k) => ({ key: k, name: both(k), line: `missed ${k}`, why: both(`why ${k}`) })),
  focus: { key: "own", move: "Ask the teacher to say their own next step, aloud.", why: "a step the teacher names is the one they try.", tryLine: { en: "Next time, what will you do?", ur: "اگلی بار؟" } },
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

const TALK_URL = "https://r2.example/talk.webm?sig=1";
const LESSON_URL = "https://r2.example/lesson.webm?sig=1";

describe("the visit lists every item in order, no 'What you made' heading (bd-o15qnr.39)", () => {
  it("send step: class recording (player), the form, the debrief, the debrief recording (player), the debrief report", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report", audioUrl: LESSON_URL }));
    L.getObservation.mockResolvedValue(VIEW("report", { talk: { guide: { intro: "g", steps: [] }, recordedAt: "2026-11-19T09:00:00Z", audioUrl: TALK_URL, feedback: { harmful: false } } }));
    renderVisit();
    const items = await screen.findByTestId("visit-items", {}, { timeout: 8000 });
    await waitFor(() => expect(within(items).getByTestId("visit-feedback")).toHaveTextContent("38%"));
    expect(screen.queryByText("What you made")).toBeNull();
    expect(screen.queryByTestId("what-you-made")).toBeNull();
    // bd-o15qnr.47 (#243): newest first, each step folded to one row; the class recording last
    const order = Array.from(items.querySelectorAll("[data-item]")).map((n) => n.getAttribute("data-item"));
    expect(order).toEqual(["debrief-report", "debrief", "debrief-recording", "form", "class-recording"]);
    const talk = within(items).getByTestId("debrief-recording");
    expect(talk).toHaveTextContent("Debrief recording");
    // compact: the bar and ±10 s open on her first tap (still skippable and 2×-able)
    expect(within(talk).queryByRole("slider")).toBeNull();
    fireEvent.click(within(talk).getByRole("button", { name: "Play" }));
    expect(within(talk).getByRole("slider", { name: "Position" })).toBeInTheDocument();
    expect(within(talk).getByRole("button", { name: "Forward 10 s" })).toBeInTheDocument();
    expect((talk.querySelector("audio") as HTMLAudioElement).getAttribute("src")).toBe(TALK_URL);
    // the class recording plays in place with the same controls
    const lesson = screen.getByTestId("class-recording");
    fireEvent.click(within(lesson).getByRole("button", { name: "Play" }));
    expect(within(lesson).getByRole("slider", { name: "Position" })).toBeInTheDocument();
    expect((lesson.querySelector("audio") as HTMLAudioElement).getAttribute("src")).toBe(LESSON_URL);
    // the action comes first, the items after it
    const send = screen.getByTestId("stage-send");
    expect(send.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sent: the report the teacher received is the FIRST item, the newest (bd-o15qnr.47)", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "sent", imageUrl: "https://r2.example/report.png", caption: "Well done", sentAt: "2026-11-19T10:00:00Z" }));
    L.getObservation.mockResolvedValue(VIEW("sent", { report: { ...VIEW("sent").report, status: "sent", imageUrl: "https://r2.example/report.png", sentAt: "2026-11-19T10:00:00Z" } }));
    renderVisit();
    const items = await screen.findByTestId("visit-items", {}, { timeout: 8000 });
    await waitFor(() => expect(items.querySelector('[data-item="teacher-report"]')).not.toBeNull());
    const order = Array.from(items.querySelectorAll("[data-item]")).map((n) => n.getAttribute("data-item"));
    expect(order[0]).toBe("teacher-report");
    expect(items.querySelector('[data-item="teacher-report"]')).toHaveTextContent("Report sent to Lubna");
    expect(screen.queryByText("What you made")).toBeNull();
  });

  // bd-o15qnr.39.2 (the operator 22 Nov ~00:55: "I can't open it ... Can I view this PDF in the app itself?"): the report
  // the teacher was sent opens full screen from the visit too, the same viewer as on Send.
  it("sent: the report the teacher received opens full screen from the visit", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "sent", imageUrl: "https://r2.example/report.png", caption: "Well done", sentAt: "2026-11-19T10:00:00Z" }));
    L.getObservation.mockResolvedValue(VIEW("sent", { report: { ...VIEW("sent").report, status: "sent", imageUrl: "https://r2.example/report.png", sentAt: "2026-11-19T10:00:00Z" } }));
    renderVisit();
    const items = await screen.findByTestId("visit-items", {}, { timeout: 8000 });
    await waitFor(() => expect(items.querySelector('[data-item="teacher-report"]')).not.toBeNull());
    const item = items.querySelector('[data-item="teacher-report"]') as HTMLElement;
    fireEvent.click(within(item).getByRole("button", { name: "View report" })); // bd-o15qnr.47: folded to one row
    fireEvent.click(within(item).getByRole("button", { name: /Open full screen/ }));
    const viewer = await screen.findByTestId("report-viewer");
    expect(within(viewer).getByTestId("report-viewer-image")).toHaveAttribute("src", "https://r2.example/report.png");
  });

  it("a WhatsApp debrief (no stored recording): no debrief player, the rest as before", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report" }));
    L.getObservation.mockResolvedValue(VIEW("report"));
    renderVisit();
    const items = await screen.findByTestId("visit-items", {}, { timeout: 8000 });
    await waitFor(() => expect(within(items).getByTestId("visit-feedback")).toBeInTheDocument());
    expect(within(items).queryByTestId("debrief-recording")).toBeNull();
  });

  it("a principal's visit lists the same items (the principal's own class recording player too)", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report", audioUrl: LESSON_URL }));
    L.getObservation.mockResolvedValue(VIEW("report", { talk: { guide: null, recordedAt: "2026-11-19T09:00:00Z", audioUrl: TALK_URL, feedback: { harmful: false } } }));
    renderVisit(true);
    const items = await screen.findByTestId("visit-items", {}, { timeout: 8000 });
    await waitFor(() => expect(within(items).getByTestId("debrief-recording")).toBeInTheDocument());
    const lesson = screen.getByTestId("class-recording");
    fireEvent.click(within(lesson).getByRole("button", { name: "Play" }));
    expect(within(lesson).getByRole("slider", { name: "Position" })).toBeInTheDocument();
  });

  it("switch off: as on production (What you made, the plain play button)", async () => {
    flow.on = false;
    C.getObservation.mockResolvedValue(OBS({ step: "sent", audioUrl: LESSON_URL }));
    L.getObservation.mockResolvedValue(VIEW("sent", { talk: { guide: { intro: "g", steps: [] }, recordedAt: "2026-11-19T09:00:00Z", audioUrl: TALK_URL, feedback: { harmful: false } } }));
    renderVisit();
    await screen.findByTestId("what-you-made", {}, { timeout: 8000 });
    expect(screen.queryByTestId("visit-items")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});

describe("while the Digital Coach listens to the debrief: 'Debrief: analysing' (bd-o15qnr.39)", () => {
  it("the visit: Now: Debrief: analysing, and a card saying how long and that you can leave; no Record buttons", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "talk" }));
    L.getObservation.mockResolvedValue(VIEW("listening", { talk: { guide: { intro: "g", steps: [] }, recordedAt: "2026-11-19T09:00:00Z", audioUrl: TALK_URL, feedback: null } }));
    renderVisit();
    const line = await screen.findByTestId("status-line", {}, { timeout: 8000 });
    await waitFor(() => expect(line).toHaveTextContent("Now: Debrief: analysing"));
    const card = screen.getByTestId("stage-debrief-listening");
    expect(card).toHaveTextContent("The Digital Coach is listening to your debrief");
    expect(card).toHaveTextContent("About 3 minutes");
    expect(screen.queryByTestId("stage-debrief")).toBeNull();
    expect(within(screen.getByTestId("visit-items")).getByTestId("debrief-recording")).toBeInTheDocument();
  });

  it("a list card (Needs you): its line says Debrief: analysing", () => {
    render(<ReportSegments step="talk" listening />);
    expect(screen.getByTestId("status-line")).toHaveTextContent("Now: Debrief: analysing");
  });

  it("Urdu: ڈی بریف: تجزیہ جاری", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<ReportSegments step="talk" listening />);
    expect(screen.getByTestId("status-line")).toHaveTextContent("ڈی بریف: تجزیہ جاری");
  });
});
