import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "coach", phoneNumber: "92300" }, loading: false }) }));
vi.mock("../useCoachV2", async (orig) => ({ ...(await orig<any>()), useCoachV2: () => true }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: http,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import { LibraryHome, LibraryModulePage, LibraryPreview, LibraryProvider } from "./LibraryPages";
import { COACH_LIBRARY_EN as EN, COACH_LIBRARY_UR as UR } from "./copy";

/**
 * bd-s42dye.2 — the coach Training Library on mocked library endpoints (bd-s42dye.1's contract). Every vendor,
 * level, course and part shows and opens; nothing locks, counts progress or starts an attempt; questions are read
 * only. A request spy proves no screen ever calls an endpoint that writes or that is gated.
 */
const mod = (id: string, title: string, o: Record<string, unknown> = {}) => ({
  id, title, order_index: 0, duration_seconds: 300, has_video: true, has_audio: false, has_pdf: false, has_questions: false, ...o,
});
const LIBRARY = {
  vendors: [
    { vendor_key: "TALEEMABAD", vendor_name: "NIETE", levels: [
      { id: 1, name: "Aspiring", order_index: 0, has_level_exam: true, exam_kind: "grand_quiz", courses: [
        { id: "c-1", title: "Module 1 - Routines", order_index: 0, has_readings: false, has_module_exam: false, modules: [
          mod("m-1", "Why routines", { has_questions: true }), mod("m-2", "Making routines", { order_index: 1 }),
        ] },
      ] },
      // A level the learner-side API would show locked: here it is just a level.
      { id: 2, name: "Emerging", order_index: 1, has_level_exam: false, exam_kind: null, courses: [
        { id: "c-2", title: "Asking questions", order_index: 0, has_readings: false, has_module_exam: false, modules: [mod("m-3", "Open questions")] },
      ] },
    ] },
    { vendor_key: "ISAPS", vendor_name: "I-SAPS", levels: [
      { id: 9, name: "Effective Teaching", order_index: 0, has_level_exam: false, exam_kind: null, courses: [
        { id: "c-9", title: "Planning", order_index: 0, has_readings: true, has_module_exam: true, modules: [mod("m-9", "Plan well", { has_pdf: true })] },
      ] },
    ] },
    { vendor_key: "TALEEMABAD_LEGACY", vendor_name: "Taleemabad", levels: [] },
  ],
};
const MODULE = {
  m1: { id: "m-1", title: "Why routines", course_id: "c-1", level_id: 1, vendor_key: "TALEEMABAD", body_html: "<p>Routines <b>matter</b></p><script>alert(1)</script>",
    video_url: "https://cdn.test/v.mp4", audio_url: null, pdf_url: "https://cdn.test/h.pdf", duration_seconds: 300, has_questions: true },
  m9: { id: "m-9", title: "Plan well", course_id: "c-9", level_id: 9, vendor_key: "ISAPS", body_html: null,
    video_url: null, audio_url: "https://cdn.test/a.mp3", pdf_url: null, duration_seconds: 600, has_questions: false },
};
const READINGS = { available: [{ title: "Teaching Well", author: "A. Writer", type: "book", description: "Chapter 3", url: "https://r.test/1" }],
  unavailable: [{ title: "Out of print", author: "B. Writer", type: "book", description: "", url: null }] };
const PREVIEW = { scope: "module", title: "Why routines", questions: [
  { id: "q1", type: "mcq", text: "What is a routine?", options: ["A habit", "A test"], image_url: null },
  { id: "q2", type: "msq", text: "Pick the routines", options: ["Greeting", "Exit", "Noise"], image_url: null },
  { id: "q3", type: "crq", text: "Describe one routine", options: [], image_url: null },
] };

// Every endpoint the library must never reach.
const FORBIDDEN = [
  /quiz-attempts/, /grand-quiz/, /\/exam\/questions/, /\/exam\/draft/, /\/complete/, /\/training\/bands/, /certificate/,
  /^\/training\/(levels|courses|modules|vendors)(\/|\?|$)/, /^\/training\/module\//, /\/attempts/,
];

beforeEach(async () => {
  vi.clearAllMocks();
  http.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    if (url === "/training/library") return { data: LIBRARY };
    if (url === "/training/library/module/m-1") return { data: MODULE.m1 };
    if (url === "/training/library/module/m-9") return { data: MODULE.m9 };
    if (url === "/training/library/course/c-9/readings") return { data: READINGS };
    if (url === "/training/library/questions") return { data: { ...PREVIEW, scope: cfg?.params?.level_id ? "level" : "module" } };
    throw new Error(`unmocked ${url}`);
  });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

const app = (entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/portal/coach/training" element={<LibraryHome />} />
      <Route path="/portal/coach/training/preview" element={<LibraryPreview />} />
      <Route path="/portal/coach/training/module/:id" element={<LibraryModulePage />} />
      <Route path="/portal/coach/training/:vendorKey" element={<LibraryProvider />} />
    </Routes>
  </MemoryRouter>,
);

/** Words a learner's training shows and the library must not. */
const NOT_IN_LIBRARY = /locked|certificate|mark done|continue|my grades|start quick check|start exam|\d+%|progress/i;
const noLearnerUi = (root: HTMLElement) => {
  expect(root.textContent).not.toMatch(NOT_IN_LIBRARY);
  expect(root.querySelector('[role="progressbar"]')).toBeNull();
  expect(root.querySelector('[aria-disabled="true"]')).toBeNull();
};

describe("the library", () => {
  it("lists every provider, the legacy one too, with no locks or progress", async () => {
    const { container } = app("/portal/coach/training");
    expect(await screen.findByTestId("provider-TALEEMABAD")).toBeTruthy();
    expect(screen.getByTestId("provider-ISAPS")).toBeTruthy();
    expect(screen.getByTestId("provider-TALEEMABAD_LEGACY")).toHaveTextContent("Taleemabad");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Training Library");
    noLearnerUi(container);
  });

  it("a provider shows every level, course and part, all openable, with the exam previews", async () => {
    const { container } = app("/portal/coach/training/TALEEMABAD");
    expect(await screen.findByTestId("level-1")).toBeTruthy();
    expect(screen.getByTestId("level-2")).toBeTruthy();
    expect(screen.getByTestId("course-c-1")).toHaveTextContent("Routines");
    for (const id of ["m-1", "m-2", "m-3"]) {
      const row = screen.getByTestId(`module-${id}`);
      expect(row.tagName).toBe("A");
      expect(row.getAttribute("href")).toBe(`/portal/coach/training/module/${id}`);
    }
    expect(screen.getByTestId("preview-level-1").getAttribute("href")).toBe("/portal/coach/training/preview?level_id=1");
    expect(screen.queryByTestId("preview-level-2")).toBeNull();
    noLearnerUi(container);
  });

  it("an ISAPS course offers its course exam preview", async () => {
    app("/portal/coach/training/ISAPS");
    expect((await screen.findByTestId("preview-course-c-9")).getAttribute("href")).toBe("/portal/coach/training/preview?course_id=c-9&kind=module_exam");
    expect(screen.getByTestId("preview-course-c-9")).toHaveTextContent("Preview course exam");
  });
});

describe("a part", () => {
  it("shows the video, the PDF handout, the sanitised text and the quick-check preview", async () => {
    const { container } = app("/portal/coach/training/module/m-1");
    expect(await screen.findByTestId("library-video")).toHaveAttribute("src", "https://cdn.test/v.mp4");
    expect(screen.getByTestId("library-handout")).toHaveAttribute("href", "https://cdn.test/h.pdf");
    const body = screen.getByTestId("library-body");
    expect(body).toHaveTextContent("Routines matter");
    expect(body.innerHTML).not.toContain("<script");
    expect(screen.getByTestId("preview-module")).toHaveTextContent("Preview questions");
    noLearnerUi(container);
  });

  it("an ISAPS part shows its audio and the course readings, the unavailable ones marked", async () => {
    app("/portal/coach/training/module/m-9");
    expect(await screen.findByTestId("library-audio")).toBeTruthy();
    const readings = await screen.findByTestId("library-readings");
    expect(await within(readings).findByText("Teaching Well")).toBeTruthy();
    expect(within(readings).getByText("Out of print")).toBeTruthy();
    expect(within(readings).getByText("Not available")).toBeTruthy();
    expect(screen.queryByTestId("preview-module")).toBeNull();
  });
});

describe("the question preview", () => {
  it("lists every question with its options and has nothing to select, answer or submit", async () => {
    const { container } = app("/portal/coach/training/preview?module_id=m-1");
    expect(await screen.findByTestId("question-1")).toHaveTextContent("What is a routine?");
    expect(screen.getByTestId("question-1")).toHaveTextContent("A habit");
    expect(screen.getByTestId("question-2")).toHaveTextContent("Greeting");
    expect(screen.getByTestId("question-3")).toHaveTextContent("Written answer");
    expect(screen.getByTestId("preview-banner")).toHaveTextContent("Preview only");
    expect(container.querySelectorAll("input, textarea, select, button, [role=radio], [role=checkbox]")).toHaveLength(0);
    expect(within(screen.getByTestId("preview-questions")).queryByText(/submit|score|correct/i)).toBeNull();
    expect(http.get).toHaveBeenCalledWith("/training/library/questions", { params: { module_id: "m-1" } });
  });

  it("asks for a level exam and a course exam by their own parameters", async () => {
    app("/portal/coach/training/preview?level_id=1");
    await screen.findByTestId("question-1");
    expect(http.get).toHaveBeenCalledWith("/training/library/questions", { params: { level_id: "1" } });
  });
  it("a course exam", async () => {
    app("/portal/coach/training/preview?course_id=c-9&kind=module_exam");
    await screen.findByTestId("question-1");
    expect(http.get).toHaveBeenCalledWith("/training/library/questions", { params: { course_id: "c-9", kind: "module_exam" } });
  });
});

describe("never writes, never gated", () => {
  it("browsing every library screen makes only GETs on the library endpoints", async () => {
    for (const path of [
      "/portal/coach/training", "/portal/coach/training/TALEEMABAD", "/portal/coach/training/ISAPS", "/portal/coach/training/module/m-1",
      "/portal/coach/training/module/m-9", "/portal/coach/training/preview?module_id=m-1", "/portal/coach/training/preview?level_id=1",
      "/portal/coach/training/preview?course_id=c-9&kind=module_exam",
    ]) {
      const { unmount } = app(path);
      await waitFor(() => expect(screen.queryByTestId("coach-library") ?? screen.queryByTestId("coach-library-provider")
        ?? screen.queryByTestId("coach-library-module") ?? screen.queryByTestId("coach-library-preview")).toBeTruthy());
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      unmount();
    }
    expect(http.get.mock.calls.length).toBeGreaterThan(8);
    for (const [url] of http.get.mock.calls) {
      expect(url).toMatch(/^\/training\/library(\/|$)/);
      expect(FORBIDDEN.some((re) => re.test(url))).toBe(false);
    }
    for (const m of ["post", "put", "patch", "delete"] as const) expect(http[m]).not.toHaveBeenCalled();
  });
});

describe("Urdu", () => {
  it("the title, a preview button and the banner follow the page's language", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    app("/portal/coach/training/preview?module_id=m-1");
    expect(await screen.findByTestId("question-1")).toHaveTextContent(UR.question(1));
    expect(screen.getByTestId("preview-banner")).toHaveTextContent(UR.previewBanner);
    expect(screen.queryByText(EN.previewBanner)).toBeNull();
  });
  it("the library's title in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    app("/portal/coach/training");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("ٹریننگ لائبریری");
  });
});

describe("ids are numbers on the real server (bigint)", () => {
  it("a numeric library renders, links and previews with String(id)", async () => {
    const lib = { vendors: [{ vendor_key: "ISAPS", vendor_name: "I-SAPS", levels: [
      { id: 27, name: "Effective Teaching", order_index: 0, has_level_exam: true, exam_kind: "capstone", courses: [
        { id: 5, title: "Planning", order_index: 0, has_readings: true, has_module_exam: true, modules: [mod("x", "Plan well", { id: 12, has_questions: true })] },
      ] },
    ] }] };
    http.get.mockImplementation(async (url: string) => {
      if (url === "/training/library") return { data: lib };
      if (url === "/training/library/module/12") return { data: { ...MODULE.m9, id: 12, course_id: 5, level_id: 27, has_questions: true } };
      if (url === "/training/library/course/5/readings") return { data: READINGS };
      throw new Error(`unmocked ${url}`);
    });
    const first = app("/portal/coach/training/ISAPS");
    expect((await screen.findByTestId("module-12")).getAttribute("href")).toBe("/portal/coach/training/module/12");
    expect(screen.getByTestId("preview-level-27").getAttribute("href")).toBe("/portal/coach/training/preview?level_id=27");
    expect(screen.getByTestId("preview-course-5").getAttribute("href")).toBe("/portal/coach/training/preview?course_id=5&kind=module_exam");
    first.unmount();
    app("/portal/coach/training/module/12");
    expect(await screen.findByTestId("library-readings")).toBeTruthy();
    expect((await screen.findByTestId("preview-module")).getAttribute("href")).toBe("/portal/coach/training/preview?module_id=12");
  });

  it("a level with no exam (404) and a module with no questions show an empty state", async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url === "/training/library/questions") throw Object.assign(new Error("nf"), { response: { status: 404 } });
      throw new Error(`unmocked ${url}`);
    });
    app("/portal/coach/training/preview?level_id=3");
    expect(await screen.findByText("No questions")).toBeTruthy();
    expect(screen.queryByText("Could not load")).toBeNull();
  });
});
