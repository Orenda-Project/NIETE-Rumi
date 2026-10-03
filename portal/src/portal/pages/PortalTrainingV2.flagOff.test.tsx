import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { resetNewUiMemory } from "../lib/useNewUi";
import { TRAINING_V2_PATHS } from "../lib/trainingRoutes";

/**
 * bd-5rz1v.25 — the new Training screens ship behind `portal_new_ui`, and with the flag OFF
 * every training address must render exactly what it rendered before.
 *
 * The snapshots in __snapshots__/ were recorded against PortalTrainingV2 BEFORE the new screens
 * existed, with the layout and the navigation included: the Training page, its certificates,
 * a provider, a level, a course (with an I-SAPS module exam row), a unit, the module exam page,
 * the review URL under /v2, and the no-training state. Every flag-off state must render that
 * same markup — the flag false, absent from /config, /config still loading, /config failing.
 * A school leader with the flag on keeps the same page under her (new) menu. A difference of one class name fails this test.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
// A STABLE toast: the page's fetch effects depend on it, and a new function per render
// refetches for ever.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  portal: { getConfig: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import api, { portal } from "../services/api";
import PortalTrainingV2 from "./PortalTrainingV2";

type ConfigMode = "off" | "absent" | "loading" | "fails" | "on";

function setConfig(mode: ConfigMode) {
  const fn = vi.mocked(portal.getConfig);
  fn.mockReset();
  const features = { assessmentGenerator: false, assessmentGeneratorMessage: null };
  if (mode === "off") fn.mockResolvedValue({ success: true, features: { ...features, newUi: false } } as never);
  if (mode === "on") fn.mockResolvedValue({ success: true, features: { ...features, newUi: true } } as never);
  if (mode === "absent") fn.mockResolvedValue({ success: true, features } as never);
  if (mode === "loading") fn.mockImplementation(() => new Promise(() => {}));
  if (mode === "fails") fn.mockRejectedValue(new Error("network"));
}

const VENDORS = [
  { vendor_key: "TALEEMABAD", vendor_name: "NIETE", level_count: 2, course_count: 2, module_count: 20, completed_module_count: 5, certificate_count: 1, avg_score_pct: 80 },
  { vendor_key: "ISAPS", vendor_name: "I-SAPS", level_count: 1, course_count: 9, module_count: 54, completed_module_count: 6, certificate_count: 0, avg_score_pct: null },
  { vendor_key: "BEACONHOUSE", vendor_name: "Beacon House", level_count: 2, course_count: 4, module_count: 40, completed_module_count: 1, certificate_count: 0, avg_score_pct: null },
];

function level(id: number, name: string, vendor_key: string, order_index: number, state: string, unlock_logic = "chain") {
  return {
    id, name, order_index, cpd_level: null, vendor_key, unlock_logic, state,
    module_count: 10, completed_count: state === "certified" ? 10 : 2, courses_total: 5, courses_completed: state === "certified" ? 5 : 2,
    passed_at: state === "certified" ? "2026-09-20T09:00:00Z" : null, cooldown_until: null,
    previous_level_order: order_index > 0 ? order_index - 1 : null,
  };
}
const LEVELS = [
  level(1, "Aspiring", "TALEEMABAD", 0, "certified"),
  level(2, "Emerging", "TALEEMABAD", 1, "in_progress"),
  level(3, "Skilled", "TALEEMABAD", 2, "locked"),
  level(9, "Effective Teaching", "ISAPS", 0, "in_progress", "all_modules"),
  level(18, "English", "BEACONHOUSE", 0, "in_progress", "all_modules"),
  level(19, "Maths", "BEACONHOUSE", 1, "not_started", "all_modules"),
];
const COURSES = [
  { id: "c-1", title: "Classroom Routines", course_type: "core", order_index: 0, module_count: 3, completed_count: 3 },
  { id: "c-2", title: "Group Work", course_type: "core", order_index: 1, module_count: 4, completed_count: 2 },
];
const MODULES = [
  { id: "m-1", title: "Why groups", order_index: 0, duration_seconds: 720, has_video: true, has_audio: false, has_pdf: false, has_questions: true, completed_at: "2026-09-30T10:00:00Z", lock: "passed" },
  { id: "m-2", title: "Making groups", order_index: 1, duration_seconds: 480, has_video: true, has_audio: true, has_pdf: true, has_questions: true, completed_at: "2026-10-01T10:00:00Z", lock: "passed" },
  { id: "m-3", title: "Noise and rules", order_index: 2, duration_seconds: 540, has_video: false, has_audio: false, has_pdf: false, has_questions: false, completed_at: null, lock: "next" },
  { id: "m-4", title: "Checking work", order_index: 3, duration_seconds: 660, has_video: false, has_audio: false, has_pdf: false, has_questions: true, completed_at: null, lock: "locked" },
];
const EXAM = { available: true, body: "Two questions and one written answer.", caption: "Pass to open the next module.", cta: "Take the exam", module_no: 2 };
const READINGS = {
  available: [{ title: "Teaching in groups", author: "A. Writer", type: "Book", description: "", url: "https://example.org/r1" }],
  unavailable: [{ title: "Classroom talk", author: "B. Writer", type: "Video", description: "", url: null }],
};
const DETAIL = {
  id: "m-2", title: "Making groups", content_html: "<p>Groups of four work best.</p>",
  video_url: "https://r2.example/v.mp4", audio_url: "https://r2.example/a.mp3", pdf_url: "https://r2.example/h.pdf",
  has_questions: true, duration_seconds: 480, order_index: 1, completed_at: "2026-10-01T10:00:00Z",
  course: { id: "c-2", title: "Group Work" }, level: { id: 2, name: "Emerging" },
};
const ATTEMPTS = [{ id: "a-1", completed_at: "2026-10-01T10:05:00Z", score: 4, max_score: 5, quiz_kind: "training_module" }];
const QUESTIONS = [
  { id: 11, question_text: "A group is too loud. What first?", options: ["Shout louder", "Use the quiet signal", "Stop the activity", "Ignore it"], order_index: 0 },
];
const CERTS = [
  { id: "a", certificate_code: "NIETE-1", level_name: "Aspiring", vendor_key: "TALEEMABAD", vendor_name: "NIETE", teacher_name: "Ayesha Khan", issued_at: "2026-09-20T00:00:00Z", has_pdf: true, download_url: "/api/portal/training/certificates/NIETE-1/download" },
];
const GATE = {
  state: "courses_incomplete", question_count: 20, exam_kind: "grand_quiz", pass_mark_pct: 80, cooldown_hours: 24,
  cooldown_until: null, courses_total: 5, courses_started: 2, passed_at: null, certificate: null,
};

let levels: unknown[] = LEVELS;
let vendors: unknown[] = VENDORS;

function wireApi() {
  vi.mocked(api.get).mockImplementation(((url: string) => {
    const ok = (data: unknown) => Promise.resolve({ data });
    if (url === "/training/vendors") return ok({ vendors });
    if (url === "/training/levels") return ok({ levels });
    if (url === "/training/certificates") return ok({ certificates: CERTS });
    if (url === "/training/courses") return ok({ courses: COURSES });
    if (url === "/training/modules") return ok({ modules: MODULES, exam: EXAM, readings: READINGS });
    if (url === "/training/module/m-2") return ok({ module: DETAIL });
    if (/^\/training\/module\/m-\d\/attempts$/.test(url)) return ok({ attempts: ATTEMPTS });
    if (/^\/training\/module\/m-\d\/questions$/.test(url)) return ok({ questions: QUESTIONS });
    if (/^\/training\/module\/c-\d\/exam\/attempts$/.test(url)) return ok({ attempts: [] });
    if (/^\/training\/module\/c-\d\/exam\/questions$/.test(url)) return new Promise(() => {});
    if (/^\/training\/level\/\d+\/grand-quiz$/.test(url)) return ok({ grand_quiz: GATE });
    if (/^\/training\/level\/\d+\/capstone$/.test(url)) return ok({ attempt: null });
    if (/^\/training\/level\/\d+\/certificate$/.test(url)) return ok({ state: "locked", certificate: null, units_total: 54, units_done: 6, exams_total: 9, exams_done: 1, scores: null });
    if (url === "/training/bands") return ok({ options: [{ id: "PRIMARY", title: "Primary (Grades 1-5)" }, { id: "MIDDLE", title: "Middle (Grades 6-8)" }], selected: [], can_change: true, is_first_selection: true, hours_remaining: 0, notice: null });
    return ok({});
  }) as never);
}

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

async function settle() {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

/** The training slice of App.tsx's route table, as the app mounts it. */
function mount(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_V2_PATHS.map((p) => <Route key={p} path={p} element={<PortalTrainingV2 />} />)}
      </Routes>
    </MemoryRouter>
  );
}

async function renderAt(path: string, mode: ConfigMode, role = "teacher") {
  resetNewUiMemory();
  setConfig(mode);
  wireApi();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", lastName: "Khan", role, phoneNumber: "923001234567" },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  const { container } = render(mount(path));
  await settle();
  const html = normalise(container.innerHTML);
  const page = normalise(container.querySelector('[data-testid="training-v2-root"]')?.outerHTML ?? "");
  cleanup();
  return { html, page };
}

const PAGES: Array<[string, string]> = [
  ["training", "/portal/training"],
  ["certificates", "/portal/training/certificates"],
  ["provider", "/portal/training/provider/TALEEMABAD"],
  ["level", "/portal/training/provider/TALEEMABAD/level/2"],
  ["level-isaps", "/portal/training/provider/ISAPS/level/9"],
  ["course", "/portal/training/provider/TALEEMABAD/level/2/course/c-2"],
  ["unit", "/portal/training/unit/m-2"],
  ["module-exam", "/portal/training/exam/c-2"],
  ["review-url", "/portal/training/v2/provider/BEACONHOUSE"],
];

describe("bd-5rz1v.25 — flag off: every training page is exactly what it was", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    levels = LEVELS;
    vendors = VENDORS;
  });

  it.each(PAGES)("%s (%s) — the same markup in every flag-off state; a leader keeps the page", { timeout: 60_000 }, async (name, path) => {
    const off = await renderAt(path, "off");
    expect(off.page).not.toBe("");
    expect(off.html).toMatchSnapshot(name);
    for (const mode of ["absent", "loading", "fails"] as const) {
      expect((await renderAt(path, mode)).html, mode).toBe(off.html);
    }
    // A school leader keeps the old training page; with the flag on only her MENU is new.
    const leaderOff = await renderAt(path, "off", "principal");
    expect((await renderAt(path, "on", "principal")).page, "leader, flag on").toBe(leaderOff.page);
  });

  it("no training assigned: the band picker, unchanged", { timeout: 60_000 }, async () => {
    levels = [];
    vendors = [];
    const off = await renderAt("/portal/training", "off");
    expect(off.html).toContain('data-testid="training-no-assignment"');
    expect(off.html).toMatchSnapshot("no-assignment");
    expect((await renderAt("/portal/training", "fails")).html).toBe(off.html);
  });
});
