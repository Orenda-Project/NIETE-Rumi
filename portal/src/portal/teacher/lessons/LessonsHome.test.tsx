import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans main page (v28 canvas Lessons) and the reopen-by-key page.
 *
 *   Select your class      her classes that HAVE lesson plans (GET /me/grade-subjects?feature=lessons,
 *                          available only) in the kit's GradeSubjectPicker; a pick goes straight to that
 *                          subject's chapters, with the catalogue's own key and the one subject key
 *   or · Any grade or subject   the kit's GradeSubjectSelector; Open (off until both) → its chapters, the
 *                          subject's catalogue key read from the catalogue
 *   Recent Lesson Plans    collapsed by default; her recent plans (lib/recentLessonPlans, both ways she had
 *                          them, both grade bands) by Pakistan day, each reopening by its key
 *   open?plan=…            reopens a plan by key: grades 1–5 straight to the viewer; 6–12 asked for in the
 *                          language she had it in — written → the viewer, being written → Preparing
 */

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { LessonsHomePage } from "./LessonsHome";
import { OpenPlanPage } from "./OpenPlanPage";
import lessonRoutes from "./routes";
import { LESSONS_ALL, LESSONS_HOME, LESSONS_OPEN, LESSONS_VIEWER, lessonsUrl } from "./paths";
import { LESSONS_V2_COPY as C } from "./copy";

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
      { grade: 4, gradeCode: "grade_4", subject: "Social Studies", subjectKey: "social_studies", source: "class", featureKey: null, available: false },
      { grade: 9, gradeCode: "grade_9", subject: "Physics", subjectKey: "physics", source: "class", featureKey: "Physics", available: true },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [
      { planKey: "k5:L2", kind: "k5", lessonId: "L2", found: true, title: "Roots and stems", grade: 4, subject: "General Science",
        chapterTitle: "Plants", dayLabel: "Day 2", lastUsedAt: hoursAgo(1), lastOpenedAt: hoursAgo(1), lastReceivedAt: null, open: { lane: "k5", lessonId: "L2" } },
      { planKey: "g612:S9", kind: "g612", segmentId: "S9", lang: "ur", found: true, title: "Speed", grade: 9, subject: "Physics",
        chapterTitle: "Motion", dayLabel: null, lastUsedAt: hoursAgo(30), lastOpenedAt: null, lastReceivedAt: hoursAgo(30), open: { lane: "g612", segmentId: "S9", lang: "ur" } },
    ] }),
    "/lp612/mine": () => ({ lessons: [] }),
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 4 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 9 }] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "math", subject: "Math", lesson_count: 80 }] }),
  };
  http.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
    const hit = Object.entries(answers).find(([k]) => url === k || url.startsWith(`${k}/`));
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit[1](cfg?.params) };
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-path={loc.pathname} data-search={loc.search} data-state={JSON.stringify(loc.state ?? null)} />;
}
function renderAt(path: string, element: React.ReactElement) {
  const [pathname, search] = path.split("?");
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : "" }]}>
      <Routes>
        <Route path={pathname} element={element} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where");

describe("Select your class", () => {
  it("her classes WITH lesson plans; each goes to its chapters with the catalogue key and the subject key", async () => {
    renderAt(LESSONS_HOME, <LessonsHomePage />);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.selectClass) }));
    const sheet = screen.getByRole("dialog", { name: C.selectClass });
    const links = within(sheet).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\s+/g, " ").trim())).toEqual(
      expect.arrayContaining([expect.stringContaining("Mathematics"), expect.stringContaining("Physics")]),
    );
    expect(within(sheet).queryByText(/Social Studies/)).toBeNull();
    const maths = links.find((l) => /Mathematics/.test(l.textContent || ""))!;
    expect(maths.getAttribute("href")).toBe(lessonsUrl("chapters", { grade: 4, subject: "math", key: "maths" }));
    const physics = links.find((l) => /Physics/.test(l.textContent || ""))!;
    expect(physics.getAttribute("href")).toBe(lessonsUrl("chapters", { grade: 9, subject: "Physics", key: "physics" }));
  });

  it("no class with lesson plans: no picker, no 'or' — Any grade or subject only", async () => {
    answers["/me/grade-subjects"] = () => ({ success: true, combos: [] });
    renderAt(LESSONS_HOME, <LessonsHomePage />);
    expect(await screen.findByRole("heading", { name: C.anyGradeOrSubject })).toBeTruthy();
    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/me/grade-subjects", { params: { feature: "lessons" } }));
    expect(screen.queryByRole("button", { name: new RegExp(C.selectClass) })).toBeNull();
    expect(screen.queryByText(C.or)).toBeNull();
  });
});

describe("Any grade or subject", () => {
  it("Open is off until a grade and a subject; then it goes to that subject's chapters, by its catalogue key", async () => {
    renderAt(LESSONS_HOME, <LessonsHomePage />);
    const openBtn = await screen.findByRole("button", { name: C.open });
    expect(openBtn).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Select grade/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Grade\s*4/ }));
    fireEvent.click(screen.getByRole("button", { name: /Select subject/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Select subject" })).getByRole("button", { name: "Math" }));
    expect(openBtn).toBeEnabled();
    fireEvent.click(openBtn);
    await waitFor(() => expect(where().dataset.path).toBe(lessonsUrl("chapters", { grade: 4, subject: "math" }).split("?")[0]));
    expect(new URLSearchParams(where().dataset.search).get("subject")).toBe("math");
  });
});

describe("Recent Lesson Plans", () => {
  it("collapsed at first; open: by day, how she had each, each reopening by its key", async () => {
    renderAt(LESSONS_HOME, <LessonsHomePage />);
    const toggle = await screen.findByRole("button", { name: new RegExp(C.recent) });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const roots = await screen.findByRole("link", { name: /Roots and stems/ });
    expect(roots.textContent).toContain(C.all.opened);
    const r = new URL(roots.getAttribute("href") as string, "https://x");
    expect(r.pathname).toBe(LESSONS_OPEN);
    expect(r.searchParams.get("plan")).toBe("k5:L2");
    const speed = screen.getByRole("link", { name: /Speed/ });
    expect(speed.textContent).toContain(C.all.whatsapp);
    const s = new URL(speed.getAttribute("href") as string, "https://x");
    expect([s.searchParams.get("plan"), s.searchParams.get("lang"), s.searchParams.get("grade")]).toEqual(["g612:S9", "ur", "9"]);
    expect(screen.getByText(C.days.today)).toBeTruthy();
  });

  it("See all → All lesson plans", async () => {
    renderAt(LESSONS_HOME, <LessonsHomePage />);
    await screen.findByRole("button", { name: new RegExp(C.recent) });
    const all = screen.getAllByRole("link", { name: /See all/ });
    expect(all.every((a) => a.getAttribute("href") === LESSONS_ALL)).toBe(true);
  });
});

describe("open?plan= — reopen by key", () => {
  it("grades 1–5: the viewer, in place of this page", async () => {
    renderAt(`${LESSONS_OPEN}?plan=k5:L2&title=Roots%20and%20stems&grade=4`, <OpenPlanPage />);
    await waitFor(() => expect(where().dataset.path).toBe(LESSONS_VIEWER));
    const state = JSON.parse(where().dataset.state as string);
    expect(state.lessonPlan).toEqual(expect.objectContaining({ source: { lane: "k5", lessonId: "L2", assetKind: "lesson" }, title: "Roots and stems" }));
    expect(state.dc).toEqual({ grade: 4, subjectKey: null, plan: "k5:L2", lang: null });
  });

  it("grades 6–12: asked for in her language; written → the viewer", async () => {
    http.post.mockResolvedValue({ data: { state: "ready", renderId: "R5" } });
    renderAt(`${LESSONS_OPEN}?plan=g612:S9&lang=ur&title=Speed&grade=9`, <OpenPlanPage />);
    await waitFor(() => expect(where().dataset.path).toBe(LESSONS_VIEWER));
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "S9", lang: "ur" });
    expect(JSON.parse(where().dataset.state as string).lessonPlan.source).toEqual({ lane: "g612", renderId: "R5" });
  });

  it("grades 6–12 being written → Preparing", async () => {
    http.post.mockResolvedValue({ data: { state: "authoring", renderId: "R6" } });
    renderAt(`${LESSONS_OPEN}?plan=g612:S9&lang=en&title=Speed&grade=9`, <OpenPlanPage />);
    await waitFor(() => expect(where().dataset.path).toBe(`${LESSONS_HOME}/preparing`));
    const q = new URLSearchParams(where().dataset.search);
    expect([q.get("lesson"), q.get("render"), q.get("title")]).toEqual(["S9", "R6", "Speed"]);
  });

  it("no usable key: back to Lesson Plans", async () => {
    renderAt(`${LESSONS_OPEN}?plan=nonsense`, <OpenPlanPage />);
    await waitFor(() => expect(where().dataset.path).not.toBe(LESSONS_OPEN));
  });
});

describe("routes", () => {
  it("now registers the main page (every link to Lesson Plans comes here) and open", () => {
    const paths = lessonRoutes.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining([LESSONS_HOME, LESSONS_OPEN]));
  });
});
