import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-fgj73x — Lesson Plans in the Assessment flow (the pattern every teacher feature takes):
 *
 *   main page     + New lesson plan (→ step 1), then Being made (6–12 plans still being written), then
 *                 Recent Lesson Plans, open, with See all. No picker on the main page.
 *   step 1 of 3   Grade and subject: today's ClassPicker, unchanged. Back → the main page.
 *   step 2 of 3   Chapter (Back → step 1); step 3 of 3 Lesson.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import lessonRoutes from "./routes";
import * as paths from "./paths";
import { LESSONS_ALL, LESSONS_HOME, lessonsUrl } from "./paths";
import { LESSONS_V2_COPY as C } from "./copy";
import { beforeAll as preloadFirst } from "vitest";
import { preloadAll } from "@/lib/lazyPage";

// bd-sex15q.34 — these pages are their own chunks (lib/lazyPage); load them before stepping through them synchronously.
preloadFirst(() => preloadAll({ pages: true }), 120_000);

const LESSONS_NEW = (paths as Record<string, unknown>).LESSONS_NEW as string;
const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

let answers: Record<string, (p?: Record<string, unknown>) => unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  answers = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "Mathematics", subjectKey: "maths", source: "class", featureKey: "math", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [
      { planKey: "k5:L2", kind: "k5", lessonId: "L2", found: true, title: "Roots and stems", grade: 4, subject: "General Science",
        chapterTitle: "Plants", dayLabel: "Day 2", lastUsedAt: hoursAgo(1), lastOpenedAt: hoursAgo(1), lastReceivedAt: null, open: { lane: "k5", lessonId: "L2" } },
    ] }),
    "/lp612/mine": () => ({ lessons: [
      { segmentId: "S7", renderId: "R7", state: "authoring", startedAt: hoursAgo(0.05), title: "Measuring length", grade: 9, subject: "Physics", lang: "en" },
    ] }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 4 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 9 }] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "math", subject: "Math", lesson_count: 80 }] }),
    "/curriculum/chapters": () => ({ chapters: [] }),
  };
  http.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
    const hit = Object.entries(answers).find(([k]) => url === k || url.startsWith(`${k}/`));
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit[1](cfg?.params) };
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-path={loc.pathname} data-search={loc.search} />;
}
function renderRoute(path: string) {
  const [pathname, search] = path.split("?");
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : "" }]}>
      <Routes>
        {lessonRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const backHref = () => screen.getAllByRole("link").find((a) => /back/i.test(a.getAttribute("aria-label") || ""))?.getAttribute("href");

describe("main page: + New lesson plan, Being made, Recent", () => {
  it("+ New lesson plan is a link to step 1; the main page has no picker", async () => {
    expect(LESSONS_NEW).toBe(`${LESSONS_HOME}/new`);
    renderRoute(LESSONS_HOME);
    const plus = await screen.findByRole("link", { name: new RegExp(C.newLessonPlan) });
    expect(plus.getAttribute("href")).toBe(LESSONS_NEW);
    expect(plus.textContent).toContain(C.allGrades);
    expect(screen.queryByRole("button", { name: new RegExp(C.selectGradeSubject) })).toBeNull();
  });

  it("a 6–12 plan still being written sits under Being made, not in Recent; Recent is open with See all", async () => {
    renderRoute(LESSONS_HOME);
    const making = await screen.findByRole("region", { name: C.preparing });
    expect(within(making).getByText("Measuring length")).toBeTruthy();
    const toggle = await screen.findByRole("button", { name: new RegExp(C.recent) });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("link", { name: /Roots and stems/ })).toBeTruthy();
    expect(screen.getAllByText("Measuring length")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /See all/ }).every((a) => a.getAttribute("href") === LESSONS_ALL)).toBe(true);
  });

  it("nothing being written: no Being made heading", async () => {
    answers["/lp612/mine"] = () => ({ lessons: [] });
    renderRoute(LESSONS_HOME);
    await screen.findByRole("link", { name: /Roots and stems/ });
    expect(screen.queryByRole("region", { name: C.preparing })).toBeNull();
  });
});

describe("step 1 of 3: Grade and subject", () => {
  it("the picker, step 1 of 3, Back to the main page; her class goes to its chapters", async () => {
    renderRoute(LESSONS_NEW);
    expect(await screen.findByRole("progressbar", { name: C.stepOf(1, 3) })).toBeTruthy();
    expect(screen.getByText(C.gradeAndSubject)).toBeTruthy();
    expect(backHref()).toBe(LESSONS_HOME);
    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/me/grade-subjects", { params: { feature: "lessons" } }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.selectGradeSubject) }));
    const sheet = screen.getByRole("dialog", { name: C.selectGradeSubject });
    fireEvent.click(await within(sheet).findByRole("radio", { name: /^Grade 4 · Your class/ }));
    const maths = within(sheet).getByRole("link", { name: /Grade 4 · Mathematics · Your class/ });
    expect(maths.getAttribute("href")).toBe(lessonsUrl("chapters", { grade: 4, subject: "math", key: "maths" }));
  });
});

describe("steps 2 and 3", () => {
  it("Chapter is step 2 of 3 and Back goes to step 1", async () => {
    renderRoute(lessonsUrl("chapters", { grade: 4, subject: "math" }));
    expect(await screen.findByRole("progressbar", { name: C.stepOf(2, 3) })).toBeTruthy();
    expect(backHref()).toBe(LESSONS_NEW);
  });

  it("Lesson is step 3 of 3", async () => {
    renderRoute(lessonsUrl("lessons", { grade: 4, subject: "math", chapter: "c1" }));
    expect(await screen.findByRole("progressbar", { name: C.stepOf(3, 3) })).toBeTruthy();
  });
});
