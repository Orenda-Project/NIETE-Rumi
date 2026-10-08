import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans opens a plan in ITS viewer page, not over today's
 * Curriculum page. The one opener takes the page (and anything else the page needs in its history
 * entry) as options; left out, it opens over Curriculum exactly as before.
 */

vi.mock("../services/api", () => ({ default: { get: vi.fn() } }));
vi.mock("./recordingSession", () => ({ useRecordingSession: () => null }));

import { LESSON_PLAN_PAGE, useLessonPlanOpener, type LessonPlanSource } from "./lessonPlanOpen";

const SOURCE: LessonPlanSource = { lane: "k5", lessonId: "grade_4_math_ch1_seg1", assetKind: "lesson" };

function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/start"]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ open: useLessonPlanOpener(), location: useLocation() }), { wrapper });
}

describe("useLessonPlanOpener", () => {
  it("left alone: over the Curriculum page, with the plan in the history entry (as before)", async () => {
    const { result } = setup();
    await act(async () => { await result.current.open(SOURCE, "Shapes"); });
    expect(result.current.location.pathname).toBe(LESSON_PLAN_PAGE);
    expect(result.current.location.state).toEqual({ lessonPlan: { source: SOURCE, title: "Shapes" } });
  });

  it("with a page: opens there, with the plan AND what that page asked to carry", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.open(SOURCE, "Shapes", {
        crumb: "Math · Chap 1", page: "/portal/teacher/lessons/plan", state: { dc: { grade: 4, plan: "k5:x" } },
      });
    });
    expect(result.current.location.pathname).toBe("/portal/teacher/lessons/plan");
    expect(result.current.location.state).toEqual({
      lessonPlan: { source: SOURCE, title: "Shapes", crumb: "Math · Chap 1" },
      dc: { grade: 4, plan: "k5:x" },
    });
  });
});
