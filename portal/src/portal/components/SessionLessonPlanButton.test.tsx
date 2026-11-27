import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";

const sw = vi.hoisted(() => ({ on: false }));
vi.mock("../lib/lessonPlanSwitch", () => ({ useLessonPlanOpen: () => sw.on }));
vi.mock("./LessonPlanSheet", () => ({ default: ({ view }: any) => <div data-testid="lesson-plan-sheet">{view.source.sessionId}:{view.source.fileKind}</div> }));
import { SessionLessonPlanButton } from "./SessionLessonPlanButton";

/** bd-kijmb8 (queue #318) — the teacher's report page: one Lesson plan row, only with the switch on AND a plan linked. */
const LP = { source: "own" as const, openable: true, fileKind: "image" as const, title: null };
beforeEach(async () => {
  sw.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("SessionLessonPlanButton", () => {
  it("opens the session's photo plan over the page", () => {
    render(<SessionLessonPlanButton sessionId="s1" lessonPlan={LP} />);
    fireEvent.click(screen.getByTestId("lesson-plan-open"));
    expect(screen.getByTestId("lesson-plan-sheet")).toHaveTextContent("s1:image");
  });
  it("switch off: nothing", () => {
    sw.on = false;
    render(<SessionLessonPlanButton sessionId="s1" lessonPlan={LP} />);
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
  });
  it("no plan linked (or an older server): nothing", () => {
    const { rerender } = render(<SessionLessonPlanButton sessionId="s1" lessonPlan={undefined} />);
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
    rerender(<SessionLessonPlanButton sessionId="s1" lessonPlan={{ ...LP, source: "none", openable: false }} />);
    expect(screen.queryByTestId("lesson-plan-open")).toBeNull();
  });
});
