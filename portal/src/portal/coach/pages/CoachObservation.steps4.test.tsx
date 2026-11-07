import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../training/appReady", async (orig) => ({ ...(await orig<Record<string, unknown>>()), coachFeatureReady: () => true }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getObservation: vi.fn() },
  leader: { getObservation: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachObservation from "./CoachObservation";
import { ReportSegments } from "../reports/ReportRows";

/**
 * bd-ewbzns.4.1 (queue #54) — one step count everywhere. The observation page said "1 of 5" (a count of steps done,
 * out of five) while the Feedback Form was hers; the list card a tap away said "Step 2 of 4". Godfather's call for the
 * operator (option A): FOUR steps everywhere — Observation analysed, Feedback Form, Debrief, Send — and the same words,
 * "Step n of 4", on the page and on the list. Reading her own feedback is not a job: it sits inside Debrief, so once
 * the debrief is coached the current step is Send, and "Your feedback" stays one tap away under What you made.
 */
const C = coach as any;
const L = leader as any;

const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-1", date: "2026-10-06T06:30:00Z", step: "draft", portal: true, mine: true, score: null, dcScore: 64,
  summary: null, teacher: { name: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1" },
  observer: { self: true, name: "Hataf Atif" }, sentAt: null, caption: null, imageUrl: null, audioUrl: null, ...extra,
});
const FEEDBACK = { harmful: false, praise_line: "You listened well.", wins: [], try: null, reflection_question: null, concern: null };
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: { intro: "Start with a win.", steps: [] }, recordedAt: "2026-10-06T09:00:00Z", feedback: ["feedback", "report", "sending"].includes(step) ? FEEDBACK : null },
  report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: "923001110001", caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/coach/observation/cs-1"]}>
      <Routes><Route path="/portal/coach/observation/:id" element={<CoachObservation />} /></Routes>
    </MemoryRouter>,
  );
}
const stepsRegion = () => within(screen.getByRole("region", { name: /Steps|مراحل/ }));
const stepLabels = () => stepsRegion().getAllByRole("listitem").map((li) => li.querySelector("span.text-\\[16px\\]")?.textContent);
const pageCount = () => stepsRegion().getByRole("heading").parentElement!.querySelector("span")!.textContent;
/** What the list card says for the same observation (its StepBar's words). */
function listCount(listStep: string): string {
  const { container, unmount } = render(<ReportSegments step={listStep} />);
  const text = within(container).getByTestId("report-segments").textContent || "";
  unmount();
  return text;
}

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("four steps, one count, on the page and the list", () => {
  it("the page lists four steps: Observation analysed, Feedback Form, Debrief, Send {name} the report", async () => {
    C.getObservation.mockResolvedValue(OBS());
    L.getObservation.mockResolvedValue(VIEW("draft"));
    renderPage();
    await waitFor(() => expect(stepLabels()).toEqual(["Observation analysed", "Feedback Form", "Debrief", "Send Ayesha the report"]));
  });

  // [the portal view's step, the list's step for the same row (coach-v2 stepOf), the count both must say]
  it.each([
    ["draft", "draft", "Step 2 of 4"],
    ["talk", "talk", "Step 3 of 4"],
    ["listening", "talk", "Step 3 of 4"],
    ["feedback", "report", "Step 4 of 4"],
    ["report", "report", "Step 4 of 4"],
  ])("at %s the page says the same as the list card (%s): %s", async (step, listStep, words) => {
    C.getObservation.mockResolvedValue(OBS({ step: listStep }));
    L.getObservation.mockResolvedValue(VIEW(step));
    renderPage();
    await waitFor(() => expect(pageCount()).toBe(words));
    cleanup();
    expect(listCount(listStep)).toContain(words);
  });

  it("her feedback is ready (no report yet): Debrief is done, Send is hers, and the dock opens Send", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report" }));
    L.getObservation.mockResolvedValue(VIEW("feedback"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("obs-dock")).toHaveAttribute("href", "/portal/coach/observation/cs-1/send"));
    expect(screen.getByTestId("obs-dock")).toHaveTextContent("Send Ayesha the report");
    const current = stepsRegion().getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")!;
    expect(current).toHaveTextContent("Send Ayesha the report");
  });

  it("…and Your feedback stays one tap away, under What you made", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report" }));
    L.getObservation.mockResolvedValue(VIEW("feedback"));
    renderPage();
    const made = within(await screen.findByTestId("what-you-made"));
    await waitFor(() => expect(made.getByRole("link", { name: /Your feedback/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/feedback"));
  });

  it("in Urdu too, the page and the list say the same count", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    C.getObservation.mockResolvedValue(OBS());
    L.getObservation.mockResolvedValue(VIEW("draft"));
    renderPage();
    // Urdu isolates the digits (bidi): compare the words, and that both say exactly the same.
    await waitFor(() => expect(pageCount()!.replace(/[\u2066-\u2069]/g, "")).toBe("مرحلہ 2 از 4"));
    const page = pageCount();
    cleanup();
    expect(listCount("draft")).toContain(page);
  });
});

/**
 * bd-ewbzns.4.4 (queue #54, sandbox 7 Nov) — after Send with WhatsApp's window closed the teacher gets an invite first;
 * the report reaches her only when she taps it. Until then the page must not say "Report sent" or "received" (bd-2675:
 * the coach is told the report landed only when it did).
 */
describe("waiting for the teacher's tap", () => {
  const SENT_VIEW = (step: string) => VIEW(step, { report: { status: step === "waiting_teacher" ? "awaiting_teacher_tap" : "sent", teacherName: "Ayesha Bibi", teacherPhone: "923001110001", caption: "Your lesson report", companionText: null, imageUrl: "https://signed.example/report.png", sentAt: null, templateSentAt: "2026-10-06T12:00:00Z" } });

  it("the done line says it waits for her, and the report is 'Sent to', not 'received'", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "sent", imageUrl: "https://signed.example/report.png", caption: "Your lesson report" }));
    L.getObservation.mockResolvedValue(SENT_VIEW("waiting_teacher"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Done/ })).toHaveTextContent("Waiting for Ayesha"));
    expect(screen.queryByText(/Report sent/)).toBeNull();
    expect(screen.getByText("Sent to Ayesha")).toBeInTheDocument();
    expect(screen.queryByText(/received/)).toBeNull();
  });

  it("once she has it: Report sent, and the report she received", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "sent", sentAt: "2026-10-06T12:30:00Z", imageUrl: "https://signed.example/report.png", caption: "Your lesson report" }));
    L.getObservation.mockResolvedValue(SENT_VIEW("done"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Done/ })).toHaveTextContent("Report sent"));
    expect(screen.getByText("The report Ayesha received")).toBeInTheDocument();
  });
});
