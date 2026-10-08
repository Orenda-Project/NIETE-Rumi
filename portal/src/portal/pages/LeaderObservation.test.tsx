import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v.6 — one observation a coach started in the portal, step by step, in
// WhatsApp /observe's order: analysed → draft → talk → her feedback → report.
// Every step is done here; the teacher gets her report on WhatsApp.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: { uploadToR2: vi.fn() },
  leader: {
    getObservation: vi.fn(), retryTalk: vi.fn(), previewReport: vi.fn(), sendReport: vi.fn(),
    presignObserveUpload: vi.fn(), startObservation: vi.fn(), startTalk: vi.fn(),
  },
}));

import { leader } from "../services/api";
import LeaderObservation from "./LeaderObservation";

const L = leader as any;

const FEEDBACK = {
  harmful: false,
  praise_line: "You let her find her own next step.",
  wins: [{ behaviour: "Opened with a strength", evidence: "you folded the paper again" }],
  try: { move: "Name one moment", evidence: "your questions asked for answers", instead: "quote one question" },
  reflection_question: "What will she try?",
  concern: null,
};

function view(over: any = {}) {
  return {
    id: "cs-1", createdAt: "2026-10-02T04:30:00Z", sessionStatus: "observer_review_complete",
    step: "talk", problem: null, preparing: false,
    teacher: { name: "Ayesha Bibi", phone: "923120004471" },
    lesson: { topic: "Fractions", subject: "Maths", hasLessonPlan: true },
    draft: { edited: true },
    talk: { guide: null, recordedAt: null, feedback: null },
    report: { status: null, teacherName: null, teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/leader/observe/cs-1"]}>
      <Routes>
        <Route path="/portal/leader/observe/:id" element={<LeaderObservation />} />
        <Route path="/portal/leader/observe/:id/draft" element={<div>draft page</div>} />
        <Route path="/portal/leader/observe/:id/talk" element={<div>talk page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  L.previewReport.mockResolvedValue({ success: true });
  L.sendReport.mockResolvedValue({ success: true });
  L.retryTalk.mockResolvedValue({ success: true });
});

describe("LeaderObservation", () => {
  it("the draft step: the tracker marks it as hers, and the button opens the draft", async () => {
    L.getObservation.mockResolvedValue(view({ step: "draft", sessionStatus: "awaiting_observer_review" }));
    renderPage();
    fireEvent.click(await screen.findByRole("link", { name: "Check the draft report" }));
    expect(await screen.findByText("draft page")).toBeInTheDocument();
  });

  it("the tracker names the teacher and walks the WhatsApp order", async () => {
    L.getObservation.mockResolvedValue(view({ step: "talk" }));
    renderPage();
    const tracker = await screen.findByTestId("observe-tracker");
    const items = Array.from(tracker.querySelectorAll("li"));
    expect(items.map((li) => li.textContent)).toEqual([
      "Lesson analysed", "Check the draft report", "Talk with Ayesha", "Your feedback", "Send Ayesha the report",
    ]);
    expect(items.map((li) => li.getAttribute("data-state"))).toEqual(["done", "done", "now", "todo", "todo"]);
  });

  it("a talk that was too short asks for another recording", async () => {
    L.getObservation.mockResolvedValue(view({ step: "talk", problem: "too_short" }));
    renderPage();
    expect(await screen.findByText(/too short to give you feedback/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a feedback failure can be tried again with the same recording", async () => {
    L.getObservation.mockResolvedValue(view({ step: "talk", problem: "feedback_failed" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(L.retryTalk).toHaveBeenCalledWith("cs-1"));
  });

  it("the coach's own feedback comes before the report — then the coach asks for the report", async () => {
    L.getObservation.mockResolvedValue(view({ step: "feedback", talk: { guide: null, recordedAt: "t", feedback: FEEDBACK } }));
    renderPage();
    expect(await screen.findByText(/You let her find her own next step/)).toBeInTheDocument();
    expect(screen.getByText("Opened with a strength")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next: send Ayesha the report/ }));
    await waitFor(() => expect(L.previewReport).toHaveBeenCalledWith("cs-1"));
  });

  it("a harmful talk shows the concern, never praise", async () => {
    const harmful = { ...FEEDBACK, harmful: true, praise_line: null, wins: [], concern: { what_happened: "a", why_it_matters: "b", instead: "c" } };
    L.getObservation.mockResolvedValue(view({ step: "feedback", talk: { guide: null, recordedAt: "t", feedback: harmful } }));
    renderPage();
    expect(await screen.findByText("One thing to look at")).toBeInTheDocument();
    expect(screen.queryByText(/🌟/)).toBeNull();
  });

  it("the preview is exactly what she will get; Send sends it", async () => {
    L.getObservation.mockResolvedValue(view({
      step: "report",
      report: { status: "awaiting_confirm", teacherName: "Ayesha Bibi", teacherPhone: "923120004471", caption: "Your lesson report", companionText: "From Sana", imageUrl: "https://r2/report.png?sig", sentAt: null, templateSentAt: null },
    }));
    renderPage();
    const img = await screen.findByAltText("Ayesha’s report");
    expect(img.getAttribute("src")).toBe("https://r2/report.png?sig");
    expect(screen.getByText("From Sana")).toBeInTheDocument();
    expect(screen.getByText(/\+923120004471/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to Ayesha" }));
    await waitFor(() => expect(L.sendReport).toHaveBeenCalledWith("cs-1"));
  });

  it("waiting for the teacher's tap, and sent", async () => {
    L.getObservation.mockResolvedValueOnce(view({ step: "waiting_teacher" }));
    const { unmount } = renderPage();
    expect(await screen.findByText(/Waiting for Ayesha/)).toBeInTheDocument();
    unmount();
    L.getObservation.mockResolvedValueOnce(view({ step: "sent" }));
    renderPage();
    expect(await screen.findByText("Sent to Ayesha")).toBeInTheDocument();
  });

  it("an observation that is not hers is not found", async () => {
    L.getObservation.mockRejectedValue({ response: { status: 404 } });
    renderPage();
    expect(await screen.findByText(/could not find this observation/i)).toBeInTheDocument();
  });
});

// bd-15y1pc — a WhatsApp observation can now be READ through this endpoint (for
// the coach v2 page); its steps still happen on WhatsApp, so this page offers none.
describe("bd-15y1pc — a WhatsApp observation opened here", () => {
  it.each([
    ["draft", "Check the draft report"],
    ["talk", "Talk with Ayesha"],
  ])("at %s: no portal action, and it says where it continues", async (step, cta) => {
    L.getObservation.mockResolvedValue(view({ step, portal: false }));
    renderPage();
    expect(await screen.findByText("This observation continues on WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: cta })).toBeNull();
  });

  it("at feedback: her feedback shows, without the button that starts the report", async () => {
    L.getObservation.mockResolvedValue(view({ step: "feedback", portal: false, talk: { guide: null, recordedAt: null, feedback: FEEDBACK } }));
    renderPage();
    expect(await screen.findByText("This observation continues on WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();
    expect(L.previewReport).not.toHaveBeenCalled();
  });
});
