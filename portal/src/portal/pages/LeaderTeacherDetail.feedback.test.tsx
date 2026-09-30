import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * bd-60174 (STEPS v1.1, principal-dashboard feedback item 1).
 *
 * "Remove the numeric scoring and total marks currently shown against each
 * teacher. Replace with a short written feedback/comment section 2 to 3 lines."
 *
 * Scope, decided with the operator 2026-09-22: the score is HIDDEN for all five
 * leader-family roles across /portal/leader/*, and it is NOT dropped — it is
 * still computed, stored and returned by the API. So these tests assert on what
 * the leader READS, never on what the payload carries, and a sibling backend
 * test asserts the payload still carries score/points/maxPoints.
 *
 * The teacher's OWN pages (/portal/dashboard, /portal/coaching/*) keep their
 * scores and are deliberately untouched: nobody complained about them, and a
 * teacher seeing her own score is the feature working.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getTeacher: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeacherDetail from "./LeaderTeacherDetail";

const SUMMARY =
  "Irene engaged students with frequent calls to recite and write; her strongest "
  + "area is High-Leverage Practices. The key growth area is Lesson Plan Fidelity: "
  + "objectives were not stated or revisited.";

const DETAIL = {
  success: true,
  teacher: { rumiUserId: "u1", name: "Irene Khan", phone: "923001234567", onRumi: true },
  stats: {
    coachingSessions: 2,
    lessonPlans: 7,
    readingAssessments: 3,
    lastScore: 64,          // still sent...
    lastSummary: SUMMARY,   // ...and this is what she should read
  },
  sessions: [
    { id: "s2", date: "2026-09-15T10:00:00Z", score: 64, points: 71, maxPoints: 148, summary: SUMMARY },
    { id: "s1", date: "2026-07-10T10:00:00Z", score: 71, points: 105, maxPoints: 148, summary: null },
  ],
};

/**
 * The page's own rendered text.
 *
 * NOT document.body.textContent: jsdom includes the text of injected <style>
 * elements, and the layout ships a rule containing "100%" — which matches a
 * percentage assertion no matter what the page renders, and would leave these
 * tests red against a correct fix (and green for the wrong reason elsewhere).
 */
function pageText(): string {
  const main = document.querySelector("main") || document.body;
  const clone = main.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style,script").forEach((n) => n.remove());
  return clone.textContent || "";
}

function mount(resolved: any = DETAIL, role = "principal") {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role }, loading: false, logout: vi.fn() });
  (leader.getTeacher as any).mockResolvedValue(resolved);
  render(
    <MemoryRouter initialEntries={["/portal/leader/teacher/u1"]}>
      <Routes>
        <Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LeaderTeacherDetail — written feedback replaces the score (bd-60174)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the written summary in the header panel", async () => {
    mount();
    // It appears twice by design — once as the headline "Latest feedback" and
    // again on its own session row — so scope to the panel rather than the page.
    await waitFor(() => expect(screen.getByTestId("latest-feedback")).toBeInTheDocument());
    expect(screen.getByTestId("latest-feedback")).toHaveTextContent(/High-Leverage Practices/);
  });

  it("shows each visit's own written note in the history", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("session-s2")).toBeInTheDocument());
    expect(screen.getByTestId("session-s2")).toHaveTextContent(/High-Leverage Practices/);
  });

  it("renders no percentage anywhere on the page", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Irene Khan/ })).toBeInTheDocument());
    expect(pageText()).not.toMatch(/\d+\s*%/);
  });

  it("renders no 'points / maxPoints marks' line", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Irene Khan/ })).toBeInTheDocument());
    // "71 / 148 marks" was the reported "total marks".
    expect(pageText()).not.toMatch(/\d+\s*\/\s*\d+\s*marks/);
    expect(pageText()).not.toMatch(/\bmarks\b/);
  });

  it("hides the score for a COACH too, not only a principal", async () => {
    // All five leader-family roles, per the operator's decision.
    mount(DETAIL, "coach");
    await waitFor(() => expect(screen.getByRole("heading", { name: /Irene Khan/ })).toBeInTheDocument());
    expect(pageText()).not.toMatch(/\d+\s*%/);
  });

  it("says plainly when a session has no written feedback yet", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Irene Khan/ })).toBeInTheDocument());
    // The older session carries summary: null — it must not render an empty
    // panel under a heading, nor silently vanish from the history.
    expect(screen.getByTestId("session-s1")).toHaveTextContent(/no written feedback/i);
  });

  it("keeps the counts that were never in question", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
