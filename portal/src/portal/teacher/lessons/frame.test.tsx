import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.3 — every Lesson Plans page wears the teacher v2 frame (TeacherPage, bd-fmf24g.1 #1984):
 * the Lesson Plans tile beside the title on the canvas's pages (main, chapters, lessons, preparing,
 * All), none on the viewer (as the canvas draws it), and a title that WRAPS — a long lesson-plan title
 * is shown in full, never cut to one line.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({ default: () => <div /> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { ChaptersPage } from "./ChaptersPage";
import { LessonsPage } from "./LessonsPage";
import { PreparingPage } from "./PreparingPage";
import { ViewerPage } from "./ViewerPage";
import { LessonsHomePage } from "./LessonsHome";
import { LessonsAllPage } from "./LessonsAll";
import { LESSONS_ALL, LESSONS_HOME, LESSONS_VIEWER, lessonsUrl } from "./paths";
import { LESSONS_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const LONG = "How plants make their own food — photosynthesis, chlorophyll and the sun's energy in the leaf";

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  http.get.mockImplementation(async (url: string) => {
    const data: Record<string, unknown> = {
      "/curriculum/grades": { grades: [{ grade: 4, subject_count: 4 }] },
      "/lp612/grades": { grades: [] },
      "/curriculum/subjects": { subjects: [{ subject_key: "math", subject: "Math", lesson_count: 80 }] },
      "/curriculum/chapters": { chapters: [{ chapter_number: 1, chapter_title: LONG, pages_label: null, lesson_count: 2 }] },
      "/curriculum/lps": { lessons: [{ lesson_id: "a", lp_type: "content", day_label: "Day 1", topic: "A", downloaded: false }] },
      "/me/grade-subjects": { success: true, combos: [] },
      "/lesson-plans/recent": { plans: [] },
      "/lp612/mine": { lessons: [] },
    };
    if (url in data) return { data: data[url] };
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});

function renderAt(path: string, element: React.ReactElement, state?: unknown) {
  const [pathname, search] = path.split("?");
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : "", state }]}>
      <Routes><Route path={pathname} element={element} /></Routes>
    </MemoryRouter>,
  );
}

const tile = () => screen.queryByTestId("page-feature-tile");

describe("the Lesson Plans tile beside the title", () => {
  it.each([
    ["main", LESSONS_HOME, <LessonsHomePage key="h" />],
    ["chapters", lessonsUrl("chapters", { grade: 4, subject: "math" }), <ChaptersPage key="c" />],
    ["lessons", lessonsUrl("lessons", { grade: 4, subject: "math", chapter: "1" }), <LessonsPage key="l" />],
    ["preparing", lessonsUrl("preparing", { grade: 9, subject: "Physics", lesson: "s", render: "r", title: "Speed" }), <PreparingPage key="p" />],
    ["All lesson plans", LESSONS_ALL, <LessonsAllPage key="a" />],
  ])("%s: the frame's tile", async (_name, path, element) => {
    renderAt(path as string, element as React.ReactElement);
    expect(await screen.findByTestId("page-feature-tile")).toBeTruthy();
  });

  it("the viewer: no tile, as the canvas draws it", () => {
    renderAt(LESSONS_VIEWER, <ViewerPage />, {
      lessonPlan: { source: { lane: "k5", lessonId: "a", assetKind: "lesson" }, title: LONG }, dc: null,
    });
    expect(tile()).toBeNull();
  });
});

describe("a long title shows in full", () => {
  it("the viewer: the whole title, in a heading that wraps", () => {
    renderAt(LESSONS_VIEWER, <ViewerPage />, {
      lessonPlan: { source: { lane: "k5", lessonId: "a", assetKind: "lesson" }, title: LONG, crumb: "Math · Chap 1" }, dc: null,
    });
    const h = screen.getByRole("heading", { level: 1 });
    expect(h.textContent).toBe(LONG);
    expect(h.className).toContain("break-words");
    expect(h.className).not.toContain("truncate");
    expect(screen.getByTestId("page-crumb").textContent).toBe("Math · Chap 1");
  });

  it("lessons: the chapter's long title in full", async () => {
    renderAt(lessonsUrl("lessons", { grade: 4, subject: "math", chapter: "1" }), <LessonsPage />);
    const h = await screen.findByRole("heading", { level: 1, name: LONG });
    expect(h.className).toContain("break-words");
  });

  it("one heading per page — the private header is gone", async () => {
    renderAt(lessonsUrl("chapters", { grade: 4, subject: "math" }), <ChaptersPage />);
    await screen.findByTestId("page-feature-tile");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(C.grade(4))).toBeTruthy();
  });
});
