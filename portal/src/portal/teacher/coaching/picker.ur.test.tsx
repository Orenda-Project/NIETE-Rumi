import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — the lesson-plan picker on the teacher v2's Digital Coaching pages, in Urdu: the plan sheet
 * (Recent lesson plans, From the library, Take a photo, Choose a file, a plan's chips) and the library's steps
 * (Not loaded, Try again, Used, Not written) are the new UI's PlanSheet and LibraryStep, which read
 * COACHING_COPY's English. The v2 pages hand them COACHING's `picker` words in the page's language; the new
 * UI's own pages hand them nothing and stay exactly as they were. MACHINE-DRAFTED Urdu (see the review file).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const session = vi.hoisted(() => ({
  active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null,
  elapsedMs: () => 0, start: vi.fn(async () => "recording"), pause: vi.fn(), resume: vi.fn(),
  finish: vi.fn(async () => null), askBeforeLogout: vi.fn(),
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => session, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(),
  getLibraryGrades: vi.fn(),
  getLibrarySubjects: vi.fn(),
  getLibraryChapters: vi.fn(),
  getLibraryLessons: vi.fn(),
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock("../../lib/recordingStore", () => ({
  latestUnsent: vi.fn(async () => null),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../../lib/coachingUpload", async (orig) => ({
  ...(await orig<typeof import("../../lib/coachingUpload")>()),
  readAudioDuration: vi.fn().mockResolvedValue(1800),
}));

// The registry first, as the app loads it.
import "../routes";
import api from "../../services/api";
import { handOffRecording } from "../../lib/lessonHandoff";
import { CoachingHomePage } from "./CoachingHome";
import { SendPage } from "./SendPage";
import { clearDraft, holdDraft } from "./draft";
import { COACHING_HOME, COACHING_SEND } from "./paths";
import { COACHING, COACHING_V2_COPY_UR as U } from "./copy";
import { copyIn } from "../i18n";
import { PlanSheet } from "../../newui/coaching/PlanSheet";
import { planChips } from "../../newui/coaching/coachingApi";
import { COACHING_COPY } from "../../newui/copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const plain = (t: string | null | undefined) => (t || "").replace(/[⁦⁩]/g, "");
const englishLeft = (words: string[]) => words.filter((w) => plain(document.body.textContent).includes(w));

const RECENT = {
  planKey: "k5:L3", kind: "k5", lessonId: "L3", found: true, title: "How plants make food", grade: 4, subject: "General Science",
  chapterNumber: 2, chapterTitle: "Plants", dayLabel: null, pagesLabel: null, lastUsedAt: "2026-10-06T04:00:00Z", lastOpenedAt: null,
  via: "portal", open: { lane: "k5", lessonId: "L3" },
};

beforeEach(async () => {
  vi.clearAllMocks();
  clearDraft();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
  const answers: Record<string, () => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "General Science", subjectKey: "science", source: "class" },
    ] }),
    "/lesson-plans/recent": () => ({ plans: [RECENT] }),
    "/teacher/coaching/history": () => ({ success: true, range: { key: "custom" }, previous: null, kpis: {}, trend: { bucketDays: 1, points: [] }, items: [], total: 0, truncated: false }),
  };
  http.get.mockImplementation(async (url: string) => {
    const hit = answers[url];
    if (!hit) throw new Error(`unexpected GET ${url}`);
    return { data: hit() };
  });
});

function at(path: string, element: React.ReactElement, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="*" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the lesson-plan picker in Urdu", () => {
  it("the hub's plan sheet: its title, Recent, From the library, Take a photo, Choose a file, a plan's grade chip", async () => {
    at(COACHING_HOME, <CoachingHomePage />);
    // The plan opens once her class has loaded (until then the button is off).
    const open = await screen.findByRole("button", { name: new RegExp(U.selectPlan) }, { timeout: 5000 }) as HTMLButtonElement;
    await waitFor(() => expect(open.disabled).toBe(false));
    fireEvent.click(open);
    const sheet = await screen.findByTestId("coaching-plan-sheet");
    expect(await within(sheet).findByText(/How plants make food/)).toBeTruthy();
    const text = plain(sheet.textContent);
    for (const w of [U.picker.lessonPlan, U.picker.recent, U.picker.fromLibrary, U.picker.takePhoto, U.picker.chooseFile, U.picker.grade(4)]) {
      expect(text).toContain(w);
    }
    expect(englishLeft(["Recent lesson plans", "From the library", "Take a photo", "Choose a file", "Grade 4"])).toEqual([]);
  });

  it("check and send → From the library: the library's Not loaded and Try again in Urdu", async () => {
    portal.getLibraryGrades.mockRejectedValue(new Error("down"));
    holdDraft({ combo: { grade: 4, subject: "General Science" }, plan: null, photos: [] });
    handOffRecording(new File(["a"], "lesson.m4a", { type: "audio/mp4" }));
    at(COACHING_SEND, <SendPage />, { start: "file" });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(U.selectPlan) }, { timeout: 5000 }));
    const sheet = await screen.findByTestId("coaching-plan-sheet");
    fireEvent.click(within(sheet).getByText(U.picker.fromLibrary));
    expect(await screen.findByText(U.picker.notLoaded)).toBeTruthy();
    expect(screen.getByRole("button", { name: U.picker.retry })).toBeTruthy();
    expect(englishLeft(["Not loaded", "Try again"])).toEqual([]);
  });

  it("the library's lessons: Used and Not written in Urdu", async () => {
    portal.getLibraryGrades.mockResolvedValue([{ grade: 7, lane: "g612" }]);
    portal.getLibrarySubjects.mockResolvedValue([{ key: "sci", label: "Science" }]);
    portal.getLibraryChapters.mockResolvedValue([{ key: "c1", label: "Cells" }]);
    portal.getLibraryLessons.mockResolvedValue([
      { id: "s1", label: "The cell", ready: true, used: true },
      { id: "s2", label: "Tissues", ready: false, used: false },
    ]);
    holdDraft({ combo: { grade: 4, subject: "General Science" }, plan: null, photos: [] });
    handOffRecording(new File(["a"], "lesson.m4a", { type: "audio/mp4" }));
    at(COACHING_SEND, <SendPage />, { start: "file" });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(U.selectPlan) }, { timeout: 5000 }));
    fireEvent.click(within(await screen.findByTestId("coaching-plan-sheet")).getByText(U.picker.fromLibrary));
    // The grades grid is labelled with the Urdu step word (a radiogroup of numbers).
    const grid = await screen.findByRole("radiogroup", { name: U.picker.steps.grade });
    fireEvent.click(within(grid).getByRole("radio", { name: /7/ }));
    fireEvent.click(await screen.findByText("Science"));
    fireEvent.click(await screen.findByText("Cells"));
    expect(await screen.findByText(U.picker.used)).toBeTruthy();
    expect(screen.getByText(U.picker.notWritten)).toBeTruthy();
    expect(englishLeft(["Used", "Not written"])).toEqual([]);
  });
});

describe("the new UI's own pages are unchanged", () => {
  it("PlanSheet with no words: COACHING_COPY's English; planChips with no words: Grade 4", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    render(<MemoryRouter><PlanSheet open onClose={() => {}} onPick={() => {}} onLibrary={() => {}} onFile={() => false} problem="not_a_plan" /></MemoryRouter>);
    expect(await screen.findByText(COACHING_COPY.recent)).toBeTruthy();
    for (const w of [COACHING_COPY.fromLibrary, COACHING_COPY.takePhoto, COACHING_COPY.chooseFile, COACHING_COPY.notAPlan]) {
      expect(screen.getByText(w)).toBeTruthy();
    }
    expect(planChips(RECENT as never)).toEqual(["Grade 4", "General Science"]);
  });

  it("the v2 picker's English is COACHING_COPY's, word for word", () => {
    const en = copyIn(COACHING, "en").picker;
    expect(en.fromLibrary).toBe(COACHING_COPY.fromLibrary);
    expect(en.steps).toEqual(COACHING_COPY.steps);
    expect(en.grade(4)).toBe(COACHING_COPY.grade(4));
  });
});
