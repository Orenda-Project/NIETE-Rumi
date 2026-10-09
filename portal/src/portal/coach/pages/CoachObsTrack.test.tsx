import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getObservation: vi.fn(), getReports: vi.fn(), getTeacher: vi.fn(), getVisit: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), cancelSchedule: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachObservation from "./CoachObservation";
import CoachReports from "./CoachReports";
import CoachTeacher from "./CoachTeacher";
import CoachVisit from "./CoachVisit";

/**
 * bd-o15qnr.19 — operator round 3:
 *  2 "When I click on any of these cards, we should go to the page where we see
 *    the complete details of a single observation …" — one v2 observation page
 *    (v24 ObsTrack) for Reports and the Teacher's History.
 *  7 "Draft should be Feedback Form, Talk should be Debrief."
 */
const C = coach as any;
const L = leader as any;

const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-1", date: "2026-10-06T06:30:00Z", step: "draft", portal: true, mine: true, score: null, dcScore: 64,
  summary: "Clear modelling.", teacher: { name: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1" },
  observer: { self: true, name: "Hataf Atif" }, sentAt: null, caption: null, imageUrl: null, audioUrl: "https://signed.example/lesson.webm", ...extra,
});
const FEEDBACK = { harmful: false, praise_line: "You listened well.", wins: [{ behaviour: "Asked open questions", evidence: "What did you notice?" }], try: null, reflection_question: null, concern: null };
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: { intro: "Start with a win.", steps: [{ title: "Went well", say_this: "Your questions were open." }] }, recordedAt: "2026-10-06T09:00:00Z", feedback: FEEDBACK },
  report: { status: "sent", teacherName: "Ayesha Bibi", teacherPhone: "923001110001", caption: "Your report", companionText: null, imageUrl: "https://signed.example/report.png", sentAt: "2026-10-06T12:00:00Z", templateSentAt: null },
  ...extra,
});
const DRAFT = {
  saved: true, scale: [{ id: "1", title: "1 · Developing" }, { id: "2", title: "2 · Proficient" }], fidelityScale: [],
  sections: [{ key: "hlp", letter: "C", title: "High-Leverage Practices", kind: "indicators", notes: [],
    indicators: [{ id: "C1", field: "C1", name: "Quality Questioning", rating: "2", evidence: "Asked why twice", improvement: "Wait longer" }] }],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/observation/:id" element={<CoachObservation />} />
        <Route path="/portal/coach/reports" element={<CoachReports />} />
        <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
        <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
      </Routes>
    </MemoryRouter>,
  );
}

const stepRows = () => screen.getAllByTestId("obs-step");

beforeEach(() => {
  vi.clearAllMocks();
  C.getObservation.mockResolvedValue(OBS());
  L.getObservation.mockResolvedValue(VIEW("draft"));
  L.getObservationDraft.mockResolvedValue(DRAFT);
});

describe("2 — Reports and History open the one observation page", () => {
  it("every Reports card and row — waiting, in progress, all, WhatsApp too — opens /portal/coach/observation/:id", async () => {
    const R = (id: string, step: string, portal: boolean) => ({ id, createdAt: "2026-10-05T09:00:00Z", teacherName: `T ${id}`, teacherPhone: null, teacherExtId: "923001110001", schoolName: "IMS Tarnol", schoolExtId: null, status: "x", step, score: step === "sent" ? 70 : null, portal });
    C.getReports.mockResolvedValue({ success: true, waiting: [R("w1", "draft", false)], inProgress: [R("p1", "analysing", true)], all: { total: 2, page: 1, pageSize: 20, items: [R("s1", "sent", false), R("s2", "sent", true)] } });
    renderAt("/portal/coach/reports");
    for (const id of ["w1", "p1", "s1", "s2"]) {
      expect((await screen.findByText(`T ${id}`)).closest("a")).toHaveAttribute("href", `/portal/coach/observation/${id}`);
    }
    expect(document.querySelector('a[href^="/portal/coach/teacher/"]')).toBeNull();
  });

  it("a teacher's HITL History rows open it too; DC rows stay information only", async () => {
    C.getTeacher.mockResolvedValue({ success: true, nextVisit: null,
      teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", emis: "110", hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
      history: [
        { id: "h-portal", date: "2026-10-05T09:00:00Z", kind: "HITL", score: 66, step: "talk", open: "observe" },
        { id: "h-wa-draft", date: "2026-08-20T09:00:00Z", kind: "HITL", score: null, step: "draft", open: null },
        { id: "h-dc", date: "2026-08-10T09:00:00Z", kind: "DC", score: 55, step: null, open: null },
      ] });
    renderAt("/portal/coach/teacher/923001110001");
    const history = await screen.findByTestId("history");
    expect(history.querySelector('a[href="/portal/coach/observation/h-portal"]')).not.toBeNull();
    expect(history.querySelector('a[href="/portal/coach/observation/h-wa-draft"]')).not.toBeNull();
    expect((within(history).getAllByTestId("history-avatar").find((a) => a.textContent === "DC")!.closest("[data-history-row]") as HTMLElement).querySelector("a")).toBeNull();
  });
});

const stepsRegion = () => within(screen.getByRole("region", { name: "Steps" }));
const stepLabels = () => stepsRegion().getAllByRole("listitem").map((li) => li.querySelector("span.text-\\[16px\\]")?.textContent);

describe("2 — the observation page (v24 ObsTrack, on the kit)", () => {
  it("header with the school and the TimeStamp, the score ring, play, and the five steps by their names", async () => {
    renderAt("/portal/coach/observation/cs-1");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Ayesha Bibi");
    expect(screen.getByText("IMSG I-10/1")).toBeInTheDocument();
    expect(screen.getByLabelText("11:30 AM")).toBeInTheDocument(); // 06:30Z on Pakistan's clock
    expect(screen.getByLabelText(/Digital Coach score 64%/)).toBeInTheDocument();
    expect(screen.getByText("Draft before your check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    await waitFor(() => expect(stepLabels()).toEqual(
      ["Observation analysed", "Feedback Form", "Debrief", "Your feedback", "Send Ayesha the report"]));
  });

  it("in progress at the Feedback Form: that step is 'Your turn' and the dock opens the v2 Feedback Form", async () => {
    renderAt("/portal/coach/observation/cs-1");
    const dock = await screen.findByTestId("obs-dock");
    expect(dock).toHaveAttribute("href", "/portal/coach/observation/cs-1/form");
    expect(dock).toHaveTextContent("Feedback Form");
    await waitFor(() => expect(stepsRegion().getByText("Your turn")).toBeInTheDocument());
    const current = stepsRegion().getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")!;
    expect(current).toHaveTextContent("Feedback Form");
  });

  it.each([
    ["talk", "Debrief", "/portal/coach/observation/cs-1/debrief"],
    ["feedback", "Your feedback", "/portal/coach/observation/cs-1/feedback"],
    ["report", "Send Ayesha the report", "/portal/coach/observation/cs-1/send"],
  ])("at %s: that step is hers, and the dock opens its v2 screen (never the old /leader/observe pages)", async (step, label, href) => {
    C.getObservation.mockResolvedValue(OBS({ step: "talk" })); // the DB knows Debrief; the portal view knows the rest
    L.getObservation.mockResolvedValue(VIEW(step));
    renderAt("/portal/coach/observation/cs-1");
    await waitFor(() => expect(screen.getByTestId("obs-dock")).toHaveTextContent(label));
    expect(screen.getByTestId("obs-dock")).toHaveAttribute("href", href);
    expect(document.querySelector('a[href^="/portal/leader/observe"]')).toBeNull();
  });

  it("a WhatsApp observation in progress says so, and offers no portal action", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "talk", portal: false, mine: false, observer: { self: false, name: "Imran S" } }));
    renderAt("/portal/coach/observation/cs-1");
    expect(await screen.findByText("On WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Continues on WhatsApp")).toBeInTheDocument();
    expect(screen.queryByTestId("obs-dock")).toBeNull();
    expect(L.getObservation).not.toHaveBeenCalled();
  });

  it("sent: the steps fold into one Done line, What you made opens her form, debrief and feedback, and the report she sent shows", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "sent", score: 66, sentAt: "2026-10-06T12:00:00Z", caption: "Your report", imageUrl: "https://signed.example/report.png" }));
    L.getObservation.mockResolvedValue(VIEW("sent"));
    renderAt("/portal/coach/observation/cs-1");
    expect(await screen.findByRole("button", { name: /Done/ })).toHaveTextContent("Report sent");
    expect(screen.queryByTestId("obs-dock")).toBeNull();
    expect(screen.getByText("Final score 66%")).toBeInTheDocument();

    const made = within(await screen.findByTestId("what-you-made"));
    await waitFor(() => expect(made.getAllByRole("link")).toHaveLength(3));
    expect(made.getByRole("link", { name: /Feedback Form/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/form");
    expect(made.getByRole("link", { name: /Debrief/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief");
    expect(made.getByRole("link", { name: /Your feedback/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/feedback");

    expect(screen.getByText("The report Ayesha received")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Ayesha/ })).toHaveAttribute("src", "https://signed.example/report.png");
    expect(screen.getByText("Your report")).toBeInTheDocument();
  });

  it("a sent WhatsApp report that is not hers: the report shows, nothing to make, no play button", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "sent", portal: false, mine: false, score: 61, caption: "Your report", imageUrl: "https://signed.example/report.png", audioUrl: null }));
    renderAt("/portal/coach/observation/cs-1");
    expect(await screen.findByRole("img", { name: /Ayesha/ })).toBeInTheDocument();
    expect(screen.queryByTestId("what-you-made")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });
});

describe("7 — Feedback Form and Debrief in the v2 screens", () => {
  it("Reports: chips and progress segments", async () => {
    const R = (id: string, step: string) => ({ id, createdAt: "2026-10-05T09:00:00Z", teacherName: `T ${id}`, teacherPhone: null, teacherExtId: null, schoolName: "IMS Tarnol", schoolExtId: null, status: "x", step, score: null, portal: true });
    C.getReports.mockResolvedValue({ success: true, waiting: [R("w1", "draft"), R("w2", "talk")], inProgress: [], all: { total: 0, page: 1, pageSize: 20, items: [] } });
    renderAt("/portal/coach/reports");
    const w1 = (await screen.findByText("T w1")).closest("a") as HTMLElement;
    expect(w1).toHaveTextContent("Feedback Form");
    const card1 = w1.closest('[data-testid="report-card"]') as HTMLElement;
    expect(within(card1).getByText("Analysed")).toBeInTheDocument();
    expect(within(card1).getAllByText(/^Feedback Form$/).length).toBeGreaterThan(0);
    expect(within(card1).getByText("Debrief")).toBeInTheDocument();
    expect((screen.getByText("T w2").closest("a") as HTMLElement)).toHaveTextContent("Debrief");
    expect(screen.queryByText(/Check draft|^Talk$|^Draft$/)).toBeNull();
  });

  it("Visit: the Last visit chip", async () => {
    C.getVisit.mockResolvedValue({ success: true, teacher: null,
      visit: { id: "v1", teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-07", scheduledSlot: "11:30", status: "upcoming" },
      lastVisit: { id: "s-wa", date: "2026-09-30T09:00:00Z", score: null, step: "talk", byMe: false, observerName: "Imran S", portal: false } });
    renderAt("/portal/coach/visit/v1");
    expect(await screen.findByRole("link", { name: /Last visit/ })).toHaveTextContent("Debrief");
  });
});
