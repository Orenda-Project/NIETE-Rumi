/**
 * bd-5rz1v.25 — training data for the new Training screens' tests, shaped like the portal's
 * training endpoints. The numbers follow deep-screens.html's Training section: NIETE 24%,
 * I-SAPS 11%, Beacon House 1%, Oxbridge done; Level 2 · Emerging with 2/5 courses; Group Work
 * with 3/7 parts.
 */
import type { Level, LevelState, ModuleSummary, Vendor } from "../portal/newui/training/trainingApi";
import type { UnitLock } from "../portal/lib/unitLock";

export const VENDORS: Vendor[] = [
  { vendor_key: "BEACONHOUSE", vendor_name: "Beacon House", level_count: 2, course_count: 8, module_count: 80, completed_module_count: 1, certificate_count: 0, avg_score_pct: null },
  { vendor_key: "ISAPS", vendor_name: "I-SAPS", level_count: 1, course_count: 9, module_count: 54, completed_module_count: 6, certificate_count: 0, avg_score_pct: null },
  { vendor_key: "OXBRIDGE", vendor_name: "Oxbridge", level_count: 1, course_count: 1, module_count: 7, completed_module_count: 7, certificate_count: 1, avg_score_pct: 90 },
  { vendor_key: "TALEEMABAD", vendor_name: "Taleemabad", level_count: 4, course_count: 20, module_count: 100, completed_module_count: 24, certificate_count: 1, avg_score_pct: 80 },
];

type LevelInit = {
  id: number; name: string; vendor_key: string; order_index: number; state: string; unlock_logic?: string;
  courses_total?: number; courses_completed?: number; module_count?: number; completed_count?: number;
};

export function level(init: LevelInit): Level {
  return {
    cpd_level: null, unlock_logic: "chain", courses_total: 5, courses_completed: 0, module_count: 30, completed_count: 0,
    passed_at: init.state === "certified" ? "2026-09-20T09:00:00Z" : null, cooldown_until: null,
    previous_level_order: init.order_index > 0 ? init.order_index - 1 : null,
    ...init,
    state: init.state as LevelState,
  };
}

export const LEVELS = [
  level({ id: 1, name: "Aspiring", vendor_key: "TALEEMABAD", order_index: 0, state: "certified", courses_total: 5, courses_completed: 5, completed_count: 30 }),
  level({ id: 2, name: "Emerging", vendor_key: "TALEEMABAD", order_index: 1, state: "in_progress", courses_total: 5, courses_completed: 2, completed_count: 12 }),
  level({ id: 3, name: "Skilled", vendor_key: "TALEEMABAD", order_index: 2, state: "locked" }),
  level({ id: 4, name: "Teacher Leader", vendor_key: "TALEEMABAD", order_index: 3, state: "locked" }),
  level({ id: 9, name: "Effective Teaching", vendor_key: "ISAPS", order_index: 0, state: "in_progress", unlock_logic: "all_modules", courses_total: 9, courses_completed: 1, completed_count: 6 }),
  level({ id: 17, name: "Game-Based Teaching", vendor_key: "OXBRIDGE", order_index: 0, state: "certified", unlock_logic: "all_modules", courses_total: 1, courses_completed: 1, completed_count: 7 }),
  level({ id: 18, name: "English", vendor_key: "BEACONHOUSE", order_index: 0, state: "in_progress", unlock_logic: "all_modules", courses_total: 4, courses_completed: 0, completed_count: 1 }),
  level({ id: 19, name: "Maths", vendor_key: "BEACONHOUSE", order_index: 1, state: "not_started", unlock_logic: "all_modules", courses_total: 4, courses_completed: 0 }),
];

export const COURSES_L2 = [
  { id: "c-1", title: "Classroom Routines", course_type: "core", order_index: 0, module_count: 3, completed_count: 3 },
  { id: "c-2", title: "Asking Questions", course_type: "core", order_index: 1, module_count: 4, completed_count: 4 },
  { id: "c-3", title: "Group Work", course_type: "core", order_index: 2, module_count: 7, completed_count: 3 },
  { id: "c-4", title: "Feedback", course_type: "core", order_index: 3, module_count: 6, completed_count: 0 },
  { id: "c-5", title: "Assessment", course_type: "core", order_index: 4, module_count: 5, completed_count: 0 },
];

function part(id: string, title: string, order_index: number, minutes: number, completed_at: string | null, lock: UnitLock = null, extra: Partial<ModuleSummary> = {}): ModuleSummary {
  return { id, title, order_index, duration_seconds: minutes * 60, has_video: true, has_audio: false, has_pdf: false, has_questions: true, completed_at, lock, ...extra };
}

/** Group Work: three done, one next, three locked (the bot's unit locks). */
export const MODULES_C3 = [
  part("m-1", "Why groups?", 0, 12, "2026-09-28T10:00:00Z", "passed"),
  part("m-2", "Making groups", 1, 8, "2026-09-29T10:00:00Z", "passed"),
  part("m-3", "Roles in a group", 2, 10, "2026-10-01T10:00:00Z", "passed"),
  part("m-4", "Noise and rules", 3, 9, null, "next", { has_pdf: true, has_audio: true }),
  part("m-5", "Checking work", 4, 11, null, "locked"),
  part("m-6", "Group projects", 5, 10, null, "locked"),
  part("m-7", "Wrap up", 6, 6, null, "locked", { has_questions: false }),
];

export const ATTEMPTS: Record<string, unknown[]> = {
  "m-1": [{ id: "a1", completed_at: "2026-09-28T10:05:00Z", score: 9, max_score: 10, quiz_kind: "training_module" }],
  "m-2": [
    { id: "a2", completed_at: "2026-09-29T10:05:00Z", score: 5, max_score: 10, quiz_kind: "training_module" },
    { id: "a3", completed_at: "2026-09-29T10:15:00Z", score: 7, max_score: 10, quiz_kind: "training_module" },
  ],
  "m-3": [{ id: "a4", completed_at: "2026-10-01T10:05:00Z", score: 6, max_score: 10, quiz_kind: "training_module" }],
};

export const CERTIFICATES = [
  { id: "a", certificate_code: "NIETE-ASP-1", level_name: "Aspiring", vendor_key: "TALEEMABAD", vendor_name: "Taleemabad", teacher_name: "Ayesha Khan", issued_at: "2026-10-03T00:00:00Z", has_pdf: true, download_url: "/api/portal/training/certificates/NIETE-ASP-1/download" },
  { id: "b", certificate_code: "BH-EN-1", level_name: "English", vendor_key: "BEACONHOUSE", vendor_name: "Beacon House", teacher_name: "Ayesha Khan", issued_at: "2026-09-20T00:00:00Z", has_pdf: true, download_url: "/api/portal/training/certificates/BH-EN-1/download" },
  { id: "c", certificate_code: "BH-MA-1", level_name: "Maths", vendor_key: "BEACONHOUSE", vendor_name: "Beacon House", teacher_name: "Ayesha Khan", issued_at: "2026-09-11T00:00:00Z", has_pdf: false, download_url: "/api/portal/training/certificates/BH-MA-1/download" },
  { id: "d", certificate_code: "OX-1", level_name: "Game-Based Teaching", vendor_key: "OXBRIDGE", vendor_name: "Oxbridge", teacher_name: "Ayesha Khan", issued_at: "2026-09-02T00:00:00Z", has_pdf: true, download_url: "/api/portal/training/certificates/OX-1/download" },
];

export const GATE_INCOMPLETE = {
  state: "courses_incomplete", question_count: 20, exam_kind: "grand_quiz", pass_mark_pct: 80, cooldown_hours: 24,
  cooldown_until: null, courses_total: 5, courses_started: 3, passed_at: null, certificate: null,
};

/** Everything a test does not set answers like a teacher mid-way through Level 2. */
export type Routes = Record<string, unknown | ((params?: Record<string, unknown>) => unknown)>;

export function trainingGet(overrides: Routes = {}) {
  const routes: Routes = {
    "/training/vendors": { vendors: VENDORS },
    "/training/levels": { levels: LEVELS },
    "/training/certificates": { certificates: CERTIFICATES },
    "/training/courses": (p?: Record<string, unknown>) => ({ courses: Number(p?.level_id) === 2 ? COURSES_L2 : [] }),
    "/training/modules": (p?: Record<string, unknown>) => ({ modules: p?.course_id === "c-3" ? MODULES_C3 : [], exam: null, readings: null }),
    "/training/level/2/grand-quiz": { grand_quiz: GATE_INCOMPLETE },
    ...overrides,
  };
  return (url: string, config?: { params?: Record<string, unknown> }) => {
    const attempts = url.match(/^\/training\/module\/([^/]+)\/attempts$/);
    if (attempts && !(url in routes)) return Promise.resolve({ data: { attempts: ATTEMPTS[attempts[1]] ?? [] } });
    if (!(url in routes)) return Promise.resolve({ data: {} });
    const r = routes[url];
    if (r instanceof Error) return Promise.reject(r);
    const data = typeof r === "function" ? (r as (p?: Record<string, unknown>) => unknown)(config?.params) : r;
    if (data instanceof Error) return Promise.reject(data);
    return Promise.resolve({ data });
  };
}

/** An axios-shaped refusal. */
export function httpError(status: number, data: Record<string, unknown> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
}

/** GET /training/module/m-4: Noise and rules — video, audio, a handout, a quick check. */
export const DETAIL_M4 = {
  id: "m-4", title: "Noise and rules", content_html: "<p>Agree a quiet signal before groups start.</p>",
  video_url: "https://r2.example/noise.mp4", audio_url: "https://r2.example/noise.mp3", pdf_url: "https://r2.example/noise.pdf",
  has_questions: true, duration_seconds: 540, order_index: 3, completed_at: null,
  course: { id: "c-3", title: "Group Work" }, level: { id: 2, name: "Emerging" },
};

/** GET /training/module/m-4/questions: five, the fourth a pick-all. */
export const QUESTIONS_M4 = [
  { id: 41, question_text: "A group is too loud. What first?", options: ["Shout louder", "Use the quiet signal", "Stop the activity", "Ignore it"], order_index: 0 },
  { id: 42, question_text: "When do you agree the rules?", options: ["Before groups start", "When it gets loud", "At the end"], order_index: 1 },
  { id: 43, question_text: "Who keeps the noise down?", options: ["Only the teacher", "A noise monitor in each group", "Nobody"], order_index: 2 },
  { id: 44, question_text: "Which are good quiet signals?", options: ["A raised hand", "Shouting", "A clap pattern", "Switching off the lights"], order_index: 3, multi: true },
  { id: 45, question_text: "After the signal, children should", options: ["stop and look", "keep talking", "leave the room"], order_index: 4 },
];

/** GET /training/level/2/grand-quiz/questions: four of the twenty, options as strings and as objects. */
export const EXAM_QUESTIONS = [
  { id: 201, question_text: "What makes a group task work?", question_urdu: null, options: ["Clear roles", "A long task", "No time limit", "One leader only"], order_index: 0 },
  { id: 202, question_text: "When should feedback come?", question_urdu: null, options: [{ key: "1", text: "Soon after the work" }, { key: "2", text: "At term end" }, { key: "3", text: "Never" }], order_index: 1 },
  { id: 203, question_text: "A child is stuck. What first?", question_urdu: null, options: ["Give the answer", "Ask a question back", "Move on"], order_index: 2 },
  { id: 204, question_text: "Exit tickets show", question_urdu: null, options: ["what each child learnt", "who is absent", "the timetable"], order_index: 3 },
];

export function gate(state: string, over: Record<string, unknown> = {}) {
  return { ...GATE_INCOMPLETE, state, ...over };
}

/** GET /training/level/18/capstone/questions — Beacon House's written exam. */
export const CAPSTONE_PAPER = {
  questions: [
    { id: 301, question_text: "How do you open a reading lesson?", order_index: 0 },
    { id: 302, question_text: "How do you check every child understood?", order_index: 1 },
  ],
  min_answer_chars: 20, points_per_question: 5, pass_mark_pct: 70,
};

/** I-SAPS module exam (course c-9): two MCQs and one written answer. */
export const MODULE_EXAM_GATE = { available: true, body: "Two scenario questions and one written answer.", caption: "", cta: "📝 Take the exam", module_no: 1 };
export const MODULE_EXAM_PAPER = {
  attempt_id: "mx-1",
  questions: [
    { id: 501, index: 0, question_text: "A pupil disrupts the lesson. Best first step?", options: ["Send them out", "Quietly redirect", "Ignore"], option_images: null, is_open_ended: false },
    { id: 502, index: 1, question_text: "Which objective is measurable?", options: ["Understand fractions", "Add two fractions with like denominators"], option_images: null, is_open_ended: false },
    { id: 503, index: 2, question_text: "Describe a lesson plan you taught this week.", options: [], option_images: null, is_open_ended: true },
  ],
};
export const BANDS_STATE = {
  options: [
    { id: "PRIMARY", title: "Primary (Grades 1-5)" },
    { id: "MIDDLE", title: "Middle (Grades 6-8)" },
    { id: "HIGH", title: "High (Grades 9-10)" },
  ],
  selected: ["PRIMARY"], can_change: true, is_first_selection: false, hours_remaining: 0,
  notice: "Once you save this, it cannot be changed again for 48 hours.",
};
