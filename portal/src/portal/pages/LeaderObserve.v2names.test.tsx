import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  leader: { getObservationDraft: vi.fn(), getObservation: vi.fn(), saveObservationDraft: vi.fn(), getTalkGuide: vi.fn(), retryTalk: vi.fn(), previewReport: vi.fn(), sendReport: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn() },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({ ...(await orig<any>()), canRecordHere: vi.fn().mockResolvedValue(false) }));
import { leader } from "../services/api";
import LeaderObserveDraft from "./LeaderObserveDraft";
import LeaderObserveTalk from "./LeaderObserveTalk";
import LeaderObservation from "./LeaderObservation";

/**
 * bd-o15qnr.19 (item 7) — the draft and talk pages are shared with flag-off
 * coaches. Reached from coach v2 (?from=coach) they say "Feedback Form" and
 * "Debrief" and go back to the v2 observation page; reached any other way they
 * render today's words, byte for byte.
 */
const L = leader as any;
const VIEW = (step: string) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Ayesha Bibi", phone: null }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
});

function at(path: string, el: React.ReactNode, route: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
        <Route path="/portal/coach/observation/:id" element={<div>V2 OBSERVATION PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservationDraft.mockResolvedValue({ saved: false, scale: [{ id: "1", title: "1 · Developing" }], fidelityScale: [], sections: [
    { key: "hlp", letter: "C", title: "High-Leverage Practices", kind: "indicators", notes: [],
      indicators: [{ id: "C1", field: "C1", name: "Quality Questioning", rating: "1", evidence: "e", improvement: "i" }] }] });
  L.getObservation.mockResolvedValue(VIEW("draft"));
  L.getTalkGuide.mockResolvedValue({ guide: null });
});

describe("draft page", () => {
  it("flag-off / not from v2: today's title, exactly", async () => {
    at("/portal/leader/observe/cs-1/draft", <LeaderObserveDraft />, "/portal/leader/observe/:id/draft");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Ayesha’s draft report$/);
    expect(screen.queryByText("Feedback Form")).toBeNull();
  });
  it("from coach v2: Feedback Form", async () => {
    at("/portal/leader/observe/cs-1/draft?from=coach", <LeaderObserveDraft />, "/portal/leader/observe/:id/draft");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Feedback Form$/);
  });
});

describe("talk page", () => {
  it("flag-off / not from v2: today's title, exactly", async () => {
    L.getObservation.mockResolvedValue(VIEW("talk"));
    at("/portal/leader/observe/cs-1/talk", <LeaderObserveTalk />, "/portal/leader/observe/:id/talk");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Talk with Ayesha$/);
  });
  it("from coach v2: Debrief", async () => {
    L.getObservation.mockResolvedValue(VIEW("talk"));
    at("/portal/leader/observe/cs-1/talk?from=coach", <LeaderObserveTalk />, "/portal/leader/observe/:id/talk");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/^Debrief$/);
  });
});

describe("observation page (feedback and report steps)", () => {
  it("flag-off / not from v2: today's tracker words, exactly", async () => {
    at("/portal/leader/observe/cs-1", <LeaderObservation />, "/portal/leader/observe/:id");
    const tracker = await screen.findByTestId("observe-tracker");
    expect([...tracker.querySelectorAll("li")].map((li) => li.textContent)).toEqual(
      ["Lesson analysed", "Check the draft report", "Talk with Ayesha", "Your feedback", "Send Ayesha the report"]);
    expect(screen.getByRole("link", { name: "Check the draft report" })).toHaveAttribute("href", "/portal/leader/observe/cs-1/draft");
  });
  it("from coach v2: Feedback Form and Debrief, and its links stay in v2", async () => {
    at("/portal/leader/observe/cs-1?from=coach", <LeaderObservation />, "/portal/leader/observe/:id");
    const tracker = await screen.findByTestId("observe-tracker");
    expect([...tracker.querySelectorAll("li")].map((li) => li.textContent)).toEqual(
      ["Lesson analysed", "Feedback Form", "Debrief", "Your feedback", "Send Ayesha the report"]);
    expect(screen.getByRole("link", { name: "Feedback Form" })).toHaveAttribute("href", "/portal/leader/observe/cs-1/draft?from=coach");
  });
});
