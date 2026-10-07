import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.14 — Lesson Plans in the new UI (deep-screens.html, "Lesson Plans"): one flow for
 * every grade, 1 to 12.
 *
 *   main      the indigo band "Lesson Plans"; Grade / Subject / Chapter / Lesson rows, each off
 *             until the one before is chosen; then Recent, her last 10 plans (bd-k23p38); a grey
 *             Open until a lesson is picked
 *   grade     a sheet of 1–12, only grades with lesson plans enabled
 *   subject   a sheet of rows: icon, name, how many lessons
 *   chapter   an inner page: number, title, pages, lesson count
 *   lessons   an inner page: day, title, pages, ✓✓ Sent; Worksheet and Revision rows too
 *   ready     an inner page: Day / pages / grade / subject, the title, Open + Answer key (1–5)
 *   viewer    the portal's own viewer under a light bar; "open in another app" a small action
 *   preparing a plan not written yet: Preparing…, a countdown ring, opens by itself
 *
 * The screens never ask which grade band they are in: grade 4 and grade 9 walk the same steps.
 */

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
}));
vi.mock("../../lib/pdfjs", () => ({ loadPdfjs: vi.fn() }));
// For the "while recording" case: a real session, with the browser's recorder stood in for.
vi.mock("../../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../../lib/recordingSupport")>()),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));
const recorder = vi.hoisted(() => ({
  id: "rec-live", start: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn(), elapsedMs: vi.fn(), stop: vi.fn(), discard: vi.fn(),
}));
vi.mock("../../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import api from "../../services/api";
import { loadPdfjs } from "../../lib/pdfjs";
import { RecordingSessionProvider, useRecordingSession } from "../../lib/recordingSession";
import NewLessonPlans from "./NewLessonPlans";
import { resetLessonPlans } from "./lessonPlansApi";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

const page = {
  getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  cleanup: vi.fn(),
};
const doc = { numPages: 2, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
const pdfjs = { getDocument: vi.fn(() => ({ promise: Promise.resolve(doc), destroy: vi.fn() })) };

const httpError = (status: number) => Object.assign(new Error(String(status)), { response: { status } });

type Answer = (params?: Record<string, unknown>) => unknown;
let routes: Record<string, Answer>;
let posts: Array<{ state: string; renderId: string } | Error>;

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => object }).getContext = () => ({});
});

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  vi.mocked(loadPdfjs).mockResolvedValue(pdfjs as unknown as Awaited<ReturnType<typeof loadPdfjs>>);
  vi.spyOn(window, "open").mockImplementation(() => null);
  recorder.start.mockResolvedValue(undefined);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(60_000);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true,
  });
  routes = {
    "/curriculum/grades": () => ({ grades: [{ grade: 1, subject_count: 3 }, { grade: 4, subject_count: 4 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 6 }, { grade: 9 }] }),
    "/lesson-plans/recent": () => ({ plans: [{
      planKey: "k5:L2", kind: "k5", lessonId: "L2", found: true, title: "Roots and stems", grade: 4, subject: "General Science",
      chapterTitle: "Plants", dayLabel: "Day 2", lastUsedAt: new Date(Date.now() - 7_200_000).toISOString(),
      lastOpenedAt: new Date(Date.now() - 7_200_000).toISOString(), lastReceivedAt: null, open: { lane: "k5", lessonId: "L2" },
    }] }),
    "/lp612/mine": () => ({ lessons: [] }),
    "/curriculum/lp/L2/file": () => PDF_BYTES,
    "/curriculum/subjects": () => ({ subjects: [
      { subject_key: "english", subject: "English", lesson_count: 113 },
      { subject_key: "general_science", subject: "General Science", lesson_count: 72 },
    ] }),
    "/curriculum/chapters": () => ({ chapters: [
      { chapter_number: 1, chapter_title: "Living Things", pages_label: "p.2-13", lesson_count: 8 },
      { chapter_number: 2, chapter_title: "Plants", pages_label: "p.14-27", lesson_count: 9 },
    ] }),
    "/curriculum/lps": () => ({ lessons: [
      { lesson_id: "g4s_d1", segment_index: 1, lp_type: "content", day_label: "Day 1", topic: "Parts of a plant", pages_label: "p.14-15", downloaded: true },
      { lesson_id: "g4s_d3", segment_index: 3, lp_type: "content", day_label: "Day 3", topic: "Leaves make food", pages_label: "p.18-20", downloaded: false },
      { lesson_id: "g4s_d4a", segment_index: 4, part: 1, lp_type: "content", day_label: "Day 4 · part 1", topic: "Flowers and seeds", pages_label: "p.21", downloaded: false },
      { lesson_id: "g4s_ws", segment_index: 995, lp_type: "assessment", day_label: "Worksheet", topic: "Chapter 2 Assessment Worksheet", pages_label: "p.26", downloaded: false },
      { lesson_id: "g4s_rv", segment_index: 990, lp_type: "revision", day_label: "Revision", topic: "Plants review", pages_label: "p.26-27", downloaded: false },
    ] }),
    "/lp612/subjects": () => ({ subjects: [{ subject: "Physics", lesson_count: 40 }] }),
    "/lp612/chapters": () => ({ chapters: [{ chapter_key: "c02", chapter_number: 2, chapter_title: "Motion", book_stem: "p9", lesson_count: 2 }] }),
    "/lp612/lessons": () => ({ lessons: [
      { segment_id: "g9p_speed", title: "Speed and velocity", pages_label: "p.10-12", ready: true },
      { segment_id: "g9p_newton", title: "Newton's laws", pages_label: "p.13", ready: false },
    ] }),
    "/curriculum/lp/g4s_d1/file": () => PDF_BYTES,
    "/curriculum/lp/g4s_d3/file": () => PDF_BYTES,
    "/curriculum/lp/g4s_d1/pdf": () => ({ available: true, url: "https://r2.example/g4.pdf" }),
    "/lp612/file/R1": () => PDF_BYTES,
    "/lp612/file/R2": () => PDF_BYTES,
    "/lp612/file/R3": () => PDF_BYTES,
  };
  posts = [];
  http.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    const answer = routes[url];
    if (!answer) throw new Error(`unexpected GET ${url}`);
    const data = await answer(config?.params);
    if (data instanceof Error) throw data;
    return { data };
  });
  http.post.mockImplementation(async (url: string) => {
    if (url !== "/lp612/request") throw new Error(`unexpected POST ${url}`);
    const next = posts.shift();
    if (!next) throw new Error("no answer queued for /lp612/request");
    if (next instanceof Error) throw next;
    return { data: { success: true, ...next } };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

const StartRecording = () => {
  const session = useRecordingSession();
  return (
    <button type="button" onClick={() => { void session?.start({ returnTo: "/portal/coaching/new" }); }}>
      test: start recording {session?.active ? "(on)" : "(off)"}
    </button>
  );
};

type Entry = string | { pathname: string; search?: string; state?: unknown };

function renderAt(entry: Entry = "/portal/curriculum", opts: { dir?: "rtl" } = {}) {
  return render(
    <div dir={opts.dir}>
      <MemoryRouter initialEntries={[entry]}>
        <RecordingSessionProvider>
          <StartRecording />
          <Where />
          <Routes>
            <Route path="/portal/curriculum" element={<NewLessonPlans />} />
          </Routes>
        </RecordingSessionProvider>
      </MemoryRouter>
    </div>,
  );
}

const where = () => screen.getByTestId("where").textContent || "";
const rowOf = (key: string) => screen.getByTestId(`lp-row-${key}`);
const gets = (url: string) => http.get.mock.calls.filter(([u]) => u === url);
const sheet = (name: string) => screen.getByRole("dialog", { name });
const crumb = () => screen.getByTestId("newui-crumb").textContent;
const title = () => screen.getByRole("heading", { level: 1 }).textContent;
const back = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));
const openButton = () => screen.getByRole("button", { name: "Open" });

/** Main page → grade 4 → General Science → Plants → the lessons page. */
async function walkToGrade4Lessons() {
  renderAt();
  await screen.findByText("Roots and stems");
  fireEvent.click(rowOf("grade"));
  await waitFor(() => expect(within(sheet("Grade")).getByRole("radio", { name: "4" })).toBeEnabled());
  fireEvent.click(within(sheet("Grade")).getByRole("radio", { name: "4" }));
  fireEvent.click(await within(await screen.findByRole("dialog", { name: "Subject" })).findByTestId("lp-subject-general_science"));
  fireEvent.click(await screen.findByTestId("lp-chapter-2"));
  await screen.findByTestId("lp-lesson-g4s_d1");
}

describe("main page", () => {
  it("is a main page: the indigo band 'Lesson Plans', no 'Last' chip — Recent says it (bd-k23p38)", async () => {
    renderAt();
    expect(screen.getByTestId("newui-main-heading")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Lesson Plans" })).toBeInTheDocument();
    await screen.findByText("Roots and stems");
    expect(screen.queryByText(/^Last/)).toBeNull();
  });

  it("shows four rows; only Grade can be tapped at first, and Open is grey", async () => {
    renderAt();
    await screen.findByText("Roots and stems");
    expect(rowOf("grade")).toBeEnabled();
    expect(rowOf("grade")).toHaveTextContent("Choose");
    for (const key of ["subject", "chapter", "lesson"]) {
      expect(rowOf(key)).toBeDisabled();
      expect(rowOf(key)).toHaveTextContent("—");
    }
    expect(openButton()).toBeDisabled();
    expect(openButton().className).toMatch(/bg-nu-button-disabled/);
  });

  it("never offers '6–12 on request' or 'My lesson plans'", async () => {
    await walkToGrade4Lessons();
    expect(document.body.textContent).not.toMatch(/on request|My lesson plans|Write this lesson plan|6-12|6–12/i);
  });
});

describe("bd-k23p38 — Recent: her last 10 lesson plans, any grade, under the four rows", () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  const recentRow = (key: string) => screen.findByTestId(`lp-recent-${key}`);

  beforeEach(() => {
    routes["/lesson-plans/recent"] = () => ({ plans: [
      {
        planKey: "k5:L2", kind: "k5", lessonId: "L2", found: true, title: "Roots and stems", grade: 4, subject: "General Science",
        chapterTitle: "Plants", dayLabel: "Day 2", lastUsedAt: iso(7_200_000), lastOpenedAt: iso(7_200_000), lastReceivedAt: null,
        open: { lane: "k5", lessonId: "L2" },
      },
      {
        planKey: "g612:g9p_newton", kind: "g612", segmentId: "g9p_newton", lang: "en", found: true, title: "Newton's laws", grade: 9,
        subject: "Physics", chapterTitle: "Motion", dayLabel: null, lastUsedAt: iso(90_000_000), lastOpenedAt: null,
        lastReceivedAt: iso(90_000_000), open: { lane: "g612", segmentId: "g9p_newton", lang: "en" },
      },
    ] });
  });

  it("asks for 10, and lists them newest first: grade, title, subject, how she last had it", async () => {
    renderAt();
    const g4 = await recentRow("k5:L2");
    const g9 = await recentRow("g612:g9p_newton:en");
    expect(gets("/lesson-plans/recent")[0][1]).toEqual({ params: { limit: 10 } });
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(g4.compareDocumentPosition(g9) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(g4).toHaveTextContent("G4");
    expect(g4).toHaveTextContent("General Science");
    expect(g4).toHaveAccessibleName(/Roots and stems.*Opened/);
    expect(g9).toHaveTextContent("G9");
    expect(g9).toHaveAccessibleName(/Newton's laws.*On WhatsApp/);
  });

  it("with no plan used yet, there is no Recent", async () => {
    routes["/lesson-plans/recent"] = () => ({ plans: [] });
    renderAt();
    await waitFor(() => expect(gets("/lesson-plans/recent")).toHaveLength(1));
    await waitFor(() => expect(gets("/lp612/mine")).toHaveLength(1));
    expect(screen.queryByText("Recent")).toBeNull();
  });

  it("a grades 6–12 plan being written is first, as Preparing…", async () => {
    routes["/lp612/mine"] = () => ({ lessons: [
      { renderId: "R3", segmentId: "g9p_speed", state: "authoring", lang: "en", startedAt: iso(60_000), title: "Speed and velocity", grade: 9, subject: "Physics" },
    ] });
    renderAt();
    const first = await recentRow("g612:g9p_speed:en");
    expect(first).toHaveTextContent("Preparing…");
    expect(first.compareDocumentPosition(await recentRow("k5:L2")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("grade 4: a tap opens it in the viewer, under 'Lesson Plans · Day 2'", async () => {
    renderAt();
    fireEvent.click(await recentRow("k5:L2"));
    await screen.findByTestId("lesson-plan-viewer");
    expect(crumb()).toBe("Lesson Plans · Day 2");
    await waitFor(() => expect(gets("/curriculum/lp/L2/file")).toHaveLength(1));
  });

  it("grade 9: a tap asks for it in its language; not written: Preparing… on the row, then it opens by itself", async () => {
    posts.push({ state: "authoring", renderId: "R2" });
    let polls = 0;
    routes["/lp612/status/R2"] = () => { polls += 1; return polls > 1 ? { state: "ready" } : { state: "authoring" }; };
    renderAt();
    const row = await recentRow("g612:g9p_newton:en");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(row);
    await waitFor(() => expect(row).toHaveTextContent("Preparing…"));
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "g9p_newton", lang: "en" });
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    await screen.findByTestId("lesson-plan-viewer");
    await waitFor(() => expect(gets("/lp612/file/R2")).toHaveLength(1));
  });
});

describe("bd-5rz1v.14 (found live on sandbox) — Back or a reload never blanks her picks", () => {
  it("the main page names her subject and chapter at once, before the catalogue answers", async () => {
    // A slow catalogue (sandbox took over 1.5s): subjects and chapters never answer here.
    routes["/curriculum/subjects"] = () => new Promise(() => {});
    routes["/curriculum/chapters"] = () => new Promise(() => {});
    window.sessionStorage.setItem("nu-lesson-plans-picks", JSON.stringify({
      grade: 4, subject: "general_science", subjectName: "General Science", chapter: "2", chapterTitle: "Plants",
      lesson: { id: "g4s_d3", kind: "day", number: 3, part: null, title: "Leaves make food", pages: "p.18-20", sent: false, answerKey: true, lane: "k5" },
    }));
    renderAt();
    await screen.findByText("Roots and stems");
    expect(rowOf("subject")).toHaveTextContent("General Science");
    expect(rowOf("chapter")).toHaveTextContent("Plants");
    expect(rowOf("lesson")).toHaveTextContent("Leaves make food");
  });

  it("the names are kept as she picks, so the main page has them however she comes back", async () => {
    await walkToGrade4Lessons();
    fireEvent.click(screen.getByTestId("lp-lesson-g4s_d3"));
    await screen.findByTestId("lp-ready");
    const kept = JSON.parse(window.sessionStorage.getItem("nu-lesson-plans-picks") || "{}");
    expect(kept).toMatchObject({ grade: 4, subject: "general_science", subjectName: "General Science", chapter: "2", chapterTitle: "Plants" });
    expect(kept.lesson).toMatchObject({ id: "g4s_d3", title: "Leaves make food" });
  });
});

describe("grade — a sheet of 1–12", () => {
  it("lists every grade 1–12; only grades with lesson plans can be picked", async () => {
    renderAt();
    fireEvent.click(rowOf("grade"));
    const grid = within(sheet("Grade")).getByRole("radiogroup", { name: "Grade" });
    await waitFor(() => expect(within(grid).getByRole("radio", { name: "9" })).toBeEnabled());
    expect(within(grid).getAllByRole("radio").map((r) => r.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    const enabled = within(grid).getAllByRole("radio").filter((r) => !(r as HTMLButtonElement).disabled).map((r) => r.textContent);
    expect(enabled).toEqual(["1", "4", "6", "9"]);
  });

  it("picking a grade fills the Grade row, opens Subject, and unlocks only the Subject row", async () => {
    renderAt();
    fireEvent.click(rowOf("grade"));
    await waitFor(() => expect(within(sheet("Grade")).getByRole("radio", { name: "4" })).toBeEnabled());
    fireEvent.click(within(sheet("Grade")).getByRole("radio", { name: "4" }));
    expect(screen.queryByRole("dialog", { name: "Grade" })).toBeNull();
    expect(await screen.findByRole("dialog", { name: "Subject" })).toBeInTheDocument();
    expect(rowOf("grade")).toHaveTextContent("4");
    expect(rowOf("subject")).toBeEnabled();
    expect(rowOf("chapter")).toBeDisabled();
    expect(rowOf("lesson")).toBeDisabled();
  });
});

describe("subject — a sheet of rows", () => {
  it("each subject is a row: its icon, its name, how many lessons", async () => {
    renderAt();
    fireEvent.click(rowOf("grade"));
    await waitFor(() => expect(within(sheet("Grade")).getByRole("radio", { name: "4" })).toBeEnabled());
    fireEvent.click(within(sheet("Grade")).getByRole("radio", { name: "4" }));
    const science = await within(await screen.findByRole("dialog", { name: "Subject" })).findByTestId("lp-subject-general_science");
    expect(science).toHaveTextContent("General Science");
    expect(science).toHaveTextContent("72");
    expect(within(science).getByTestId("newui-row-tile").querySelector("svg")).not.toBeNull();
    expect(within(sheet("Subject")).getByTestId("lp-subject-english")).toHaveTextContent("113");
  });

  it("picking one opens the chapters: an inner page, 'Lesson Plans · Grade 4'", async () => {
    renderAt();
    fireEvent.click(rowOf("grade"));
    await waitFor(() => expect(within(sheet("Grade")).getByRole("radio", { name: "4" })).toBeEnabled());
    fireEvent.click(within(sheet("Grade")).getByRole("radio", { name: "4" }));
    fireEvent.click(await within(await screen.findByRole("dialog", { name: "Subject" })).findByTestId("lp-subject-general_science"));
    await screen.findByTestId("lp-chapter-2");
    expect(screen.getByTestId("newui-inner-bar")).toBeInTheDocument();
    expect(crumb()).toBe("Lesson Plans · Grade 4");
    expect(title()).toBe("General Science");
  });
});

describe("chapter — an inner page", () => {
  it("each chapter: its number in the badge, its title, its pages, its lesson count", async () => {
    renderAt();
    fireEvent.click(rowOf("grade"));
    await waitFor(() => expect(within(sheet("Grade")).getByRole("radio", { name: "4" })).toBeEnabled());
    fireEvent.click(within(sheet("Grade")).getByRole("radio", { name: "4" }));
    fireEvent.click(await within(await screen.findByRole("dialog", { name: "Subject" })).findByTestId("lp-subject-general_science"));
    const plants = await screen.findByTestId("lp-chapter-2");
    expect(within(plants).getByTestId("newui-row-tile")).toHaveTextContent("2");
    expect(plants).toHaveTextContent("Plants");
    expect(plants).toHaveTextContent("p.14-27");
    expect(plants).toHaveTextContent("9");
  });
});

describe("lessons — an inner page", () => {
  it("'Lesson Plans · General Science', titled with the chapter", async () => {
    await walkToGrade4Lessons();
    expect(crumb()).toBe("Lesson Plans · General Science");
    expect(title()).toBe("Plants");
  });

  it("each lesson: its day badge, title and pages; ✓✓ Sent when it reached her on WhatsApp", async () => {
    await walkToGrade4Lessons();
    const d1 = screen.getByTestId("lp-lesson-g4s_d1");
    expect(within(d1).getByTestId("newui-row-tile")).toHaveTextContent("D1");
    expect(d1).toHaveTextContent("Parts of a plant");
    expect(d1).toHaveTextContent("p.14-15");
    expect(within(d1).getByText("Sent")).toBeInTheDocument();
    expect(within(screen.getByTestId("lp-lesson-g4s_d3")).queryByText("Sent")).toBeNull();
    expect(screen.getByTestId("lp-lesson-g4s_d4a")).toHaveTextContent("Part 1");
  });

  it("Worksheet and Revision are rows too, with their own icon", async () => {
    await walkToGrade4Lessons();
    const ws = screen.getByTestId("lp-lesson-g4s_ws");
    const rv = screen.getByTestId("lp-lesson-g4s_rv");
    expect(ws).toHaveTextContent("Worksheet");
    expect(rv).toHaveTextContent("Revision");
    expect(within(ws).getByTestId("newui-row-tile").querySelector("svg")).not.toBeNull();
    expect(within(rv).getByTestId("newui-row-tile").querySelector("svg")).not.toBeNull();
  });
});

describe("ready — an inner page with one big Open", () => {
  it("Day / pages / grade / subject, the title, Open and (grades 1–5) Answer key", async () => {
    await walkToGrade4Lessons();
    fireEvent.click(screen.getByTestId("lp-lesson-g4s_d3"));
    await screen.findByTestId("lp-ready");
    expect(crumb()).toBe("Lesson Plans · Plants");
    expect(title()).toBe("Day 3");
    const card = screen.getByTestId("lp-ready");
    for (const chip of ["Day 3", "p.18-20", "Grade 4", "General Science"]) expect(within(card).getByText(chip)).toBeInTheDocument();
    expect(card).toHaveTextContent("Leaves make food");
    expect(openButton()).toBeEnabled();
    expect(openButton().className).toMatch(/bg-nu-button(\s|$)/);
    expect(screen.getByRole("button", { name: "Answer key" }).className).toMatch(/border-nu-button-secondary-border/);
  });

  it("back to the main page: all four picks are still made, and Open is ready", async () => {
    await walkToGrade4Lessons();
    fireEvent.click(screen.getByTestId("lp-lesson-g4s_d3"));
    await screen.findByTestId("lp-ready");
    back(); await screen.findByTestId("lp-lesson-g4s_d3");
    expect(screen.getByTestId("lp-lesson-g4s_d3").getAttribute("aria-current")).toBe("true");
    back(); await screen.findByTestId("lp-chapter-2");
    back(); await screen.findByTestId("lp-row-grade");
    expect(rowOf("grade")).toHaveTextContent("4");
    await waitFor(() => expect(rowOf("subject")).toHaveTextContent("General Science"));
    await waitFor(() => expect(rowOf("chapter")).toHaveTextContent("Plants"));
    expect(rowOf("lesson")).toHaveTextContent("Leaves make food");
    expect(openButton()).toBeEnabled();
  });
});

describe("open — a plan that exists opens in the portal's own viewer", () => {
  it("grade 4: Open → the viewer under a light bar, fed through /curriculum/lp/:id/file (the logged open)", async () => {
    await walkToGrade4Lessons();
    fireEvent.click(screen.getByTestId("lp-lesson-g4s_d3"));
    await screen.findByTestId("lp-ready");
    fireEvent.click(openButton());
    expect(await screen.findByTestId("lesson-plan-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("newui-inner-bar")).toBeInTheDocument();
    expect(crumb()).toBe("Lesson Plans · Day 3");
    expect(title()).toBe("Leaves make food");
    await waitFor(() => expect(gets("/curriculum/lp/g4s_d3/file")).toHaveLength(1));
    expect(gets("/curriculum/lp/g4s_d3/file")[0][1]).toMatchObject({ params: { kind: "lesson" }, responseType: "arraybuffer" });
    expect(http.post).not.toHaveBeenCalled();
    // The viewer's own header is gone (the light bar is the heading); one h1.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("'open in another app' is a small action on the bar, through today's link route", async () => {
    renderAt({ pathname: "/portal/curriculum", state: { lessonPlan: { source: { lane: "k5", lessonId: "g4s_d1", assetKind: "lesson" }, title: "Parts of a plant" } } });
    await screen.findByTestId("lesson-plan-viewer");
    expect(crumb()).toBe("Lesson Plans");
    const outside = within(screen.getByTestId("newui-inner-bar")).getByRole("button", { name: "Open in another app" });
    expect(screen.getAllByRole("button", { name: "Open in another app" })).toHaveLength(1);
    fireEvent.click(outside);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://r2.example/g4.pdf", "_blank", "noopener"));
    expect(gets("/curriculum/lp/g4s_d1/pdf")[0][1]).toEqual({ params: { kind: "lesson" } });
  });

  it("Answer key opens the grades 1–5 answer key in the viewer", async () => {
    await walkToGrade4Lessons();
    fireEvent.click(screen.getByTestId("lp-lesson-g4s_d3"));
    await screen.findByTestId("lp-ready");
    routes["/curriculum/lp/g4s_d3/file"] = () => PDF_BYTES;
    fireEvent.click(screen.getByRole("button", { name: "Answer key" }));
    await screen.findByTestId("lesson-plan-viewer");
    await waitFor(() => expect(gets("/curriculum/lp/g4s_d3/file").some(([, c]) => c?.params?.kind === "answer_key")).toBe(true));
  });

  it("grade 9, already written: the same Open opens it at once, through /lp612/file/:id; no Answer key", async () => {
    posts.push({ state: "ready", renderId: "R1" });
    renderAt("/portal/curriculum?view=lesson&grade=9&subject=Physics&chapter=c02&lesson=g9p_speed");
    await screen.findByTestId("lp-ready");
    expect(title()).toBe("Lesson 1");
    await waitFor(() => expect(crumb()).toBe("Lesson Plans · Motion"));
    expect(screen.queryByRole("button", { name: "Answer key" })).toBeNull();
    fireEvent.click(openButton());
    await screen.findByTestId("lesson-plan-viewer");
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "g9p_speed", lang: "en" });
    await waitFor(() => expect(gets("/lp612/file/R1")).toHaveLength(1));
  });

  it("while a lesson records: 'Recording continues', and nothing hands the plan to another app", async () => {
    renderAt({ pathname: "/portal/curriculum", state: { lessonPlan: { source: { lane: "k5", lessonId: "g4s_d1", assetKind: "lesson" }, title: "Parts of a plant" } } });
    fireEvent.click(screen.getByRole("button", { name: /test: start recording/ }));
    await screen.findByRole("button", { name: "test: start recording (on)" });
    await screen.findByTestId("lesson-plan-viewer");
    expect(screen.getByText("Recording continues")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in another app" })).toBeNull();
  });
});

describe("open — a plan not written yet: Preparing…, then it opens by itself", () => {
  async function startNewton() {
    posts.push({ state: "authoring", renderId: "R2" });
    renderAt("/portal/curriculum?view=lesson&grade=9&subject=Physics&chapter=c02&lesson=g9p_newton");
    await screen.findByTestId("lp-ready");
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.click(openButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("newui-hero")).toBeInTheDocument();
  }

  it("shows Preparing…, a countdown ring, '~2 min' and 'Opens by itself', and 'Other lessons'", async () => {
    routes["/lp612/status/R2"] = () => ({ success: true, state: "authoring" });
    await startNewton();
    expect(where()).toContain("view=preparing");
    expect(where()).toContain("render=R2");
    const hero = screen.getByTestId("newui-hero");
    expect(hero).toHaveTextContent("Preparing…");
    expect(within(hero).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "2:00");
    expect(within(hero).getByText("~2 min")).toBeInTheDocument();
    expect(within(hero).getByText("Opens by itself")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Other lessons" }).className).toMatch(/border-nu-button-secondary-border/);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(crumb()).toBe("Lesson Plans · Grade 9 · Physics");
    expect(title()).toBe("Newton's laws");
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    expect(within(screen.getByTestId("newui-hero")).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "1:10");
  });

  it("polls with the old back-off (every 3s, 6s after 30s, 12s after 2 min) and opens the viewer by itself", async () => {
    let ready = false;
    routes["/lp612/status/R2"] = () => (ready ? { success: true, state: "ready", url: "https://r2.example/n.pdf" } : { success: true, state: "authoring" });
    await startNewton();
    const polls = () => gets("/lp612/status/R2").length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2_999); });
    expect(polls()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(polls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(27_000); });
    expect(polls()).toBe(10); // 3s apart for the first 30s
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(polls()).toBe(11); // then 6s apart
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    const at2min = polls();
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(polls()).toBe(at2min + 1); // then 12s apart
    // The poll is never an open: only "open in another app" marks one.
    for (const [, config] of gets("/lp612/status/R2")) expect(config?.params?.open).toBeUndefined();

    ready = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    vi.useRealTimers();
    expect(await screen.findByTestId("lesson-plan-viewer")).toBeInTheDocument();
    expect(title()).toBe("Newton's laws");
    await waitFor(() => expect(gets("/lp612/file/R2")).toHaveLength(1));
    // It replaced the Preparing page: Back goes to the plan, not to the wait.
    back();
    await screen.findByTestId("lp-ready");
  });

  it("past the expected time the ring gives way to a turning wheel; it still opens by itself", async () => {
    routes["/lp612/status/R2"] = () => ({ success: true, state: "authoring" });
    await startNewton();
    await act(async () => { await vi.advanceTimersByTimeAsync(121_000); });
    const hero = screen.getByTestId("newui-hero");
    expect(within(hero).queryByRole("progressbar")).toBeNull();
    expect(within(hero).getByTestId("newui-hero-icon")).toBeInTheDocument();
    expect(hero).toHaveTextContent("Preparing…");
  });

  it("if writing fails: the red Failed chip and Try again, which starts it again and opens it", async () => {
    routes["/lp612/status/R2"] = () => ({ success: true, state: "failed" });
    await startNewton();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    const hero = screen.getByTestId("newui-hero");
    const failed = within(hero).getByText("Failed");
    expect(failed.closest("[data-chip]")?.className).toMatch(/bg-nu-chip-error-bg/);
    expect(screen.queryByText("Preparing…")).toBeNull();
    vi.useRealTimers();
    posts.push({ state: "ready", renderId: "R3" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("lesson-plan-viewer")).toBeInTheDocument();
    await waitFor(() => expect(gets("/lp612/file/R3")).toHaveLength(1));
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it("'Other lessons' goes back to the chapter's lessons; the plan keeps being written", async () => {
    routes["/lp612/status/R2"] = () => ({ success: true, state: "authoring" });
    await startNewton();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Other lessons" }));
    await screen.findByTestId("lp-lesson-g9p_speed");
    expect(where()).toContain("view=lessons");
    await waitFor(() => expect(crumb()).toBe("Lesson Plans · Physics"));
    await waitFor(() => expect(title()).toBe("Motion"));
    // Grade 9 lessons: numbered, the same rows as grade 4.
    expect(within(screen.getByTestId("lp-lesson-g9p_newton")).getByTestId("newui-row-tile")).toHaveTextContent("2");
  });

  it("a plan held back says so, and stays on the page", async () => {
    posts.push(httpError(403));
    renderAt("/portal/curriculum?view=lesson&grade=9&subject=Physics&chapter=c02&lesson=g9p_newton");
    await screen.findByTestId("lp-ready");
    fireEvent.click(openButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Not available yet" })));
    expect(screen.getByTestId("lp-ready")).toBeInTheDocument();
  });
});

describe("RTL and the design rules on every step", () => {
  const PHYSICAL = /(^|\s)-?(m[lr]|p[lr]|left|right|text-left|text-right|rounded-[lr]|border-[lr])(-|\s|$)/;

  async function everyStep(check: (step: string) => void, dir?: "rtl") {
    // main + grade sheet
    renderAt("/portal/curriculum", { dir });
    await screen.findByText("Roots and stems");
    check("main");
    fireEvent.click(rowOf("grade"));
    await waitFor(() => expect(within(sheet("Grade")).getByRole("radio", { name: "4" })).toBeEnabled());
    check("grade");
    fireEvent.click(within(sheet("Grade")).getByRole("radio", { name: "4" }));
    await within(await screen.findByRole("dialog", { name: "Subject" })).findByTestId("lp-subject-general_science");
    check("subject");
    fireEvent.click(within(sheet("Subject")).getByTestId("lp-subject-general_science"));
    await screen.findByTestId("lp-chapter-2");
    check("chapter");
    fireEvent.click(screen.getByTestId("lp-chapter-2"));
    await screen.findByTestId("lp-lesson-g4s_d1");
    check("lessons");
    fireEvent.click(screen.getByTestId("lp-lesson-g4s_d3"));
    await screen.findByTestId("lp-ready");
    check("ready");
    fireEvent.click(openButton());
    await screen.findByTestId("lesson-plan-viewer");
    check("viewer");
  }

  it("mirrors in Urdu: chevrons and Back turn round, only start/end spacing", async () => {
    await everyStep((step) => {
      const root = document.body;
      for (const el of root.querySelectorAll("[data-chevron]")) expect(el.getAttribute("class"), step).toMatch(/rtl:rotate-180/);
      const backIcon = screen.queryByRole("button", { name: "Back" })?.querySelector("svg");
      if (backIcon) expect(backIcon.getAttribute("class"), step).toMatch(/rtl:-scale-x-100/);
      for (const el of root.querySelectorAll("[data-testid^='lp-'], [data-testid^='newui-']")) {
        expect(el.getAttribute("class") || "", `${step}: ${el.getAttribute("data-testid")}`).not.toMatch(PHYSICAL);
      }
    }, "rtl");
  });

  it("every tap target is 56px or more, on every step", async () => {
    await everyStep((step) => {
      // The viewer's zoom buttons included: in the new UI they sit in 56px targets too.
      const problems = tapProblems(screen.getByTestId("layout"));
      const sheets = Array.from(document.body.querySelectorAll("[role=dialog]")).flatMap((d) => tapProblems(d));
      expect([...problems, ...sheets], step).toEqual([]);
    });
  });
});
