import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — Lesson Plans in Urdu: the main page, chapters, lessons, Preparing, the viewer and All lesson
 * plans take every word from LESSONS (bilingual), none left in English; data (titles, subject names) stays as
 * the API sends it. MACHINE-DRAFTED Urdu (see the review file).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({ default: () => <div /> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { LessonsHomePage } from "./LessonsHome";
import { ChaptersPage } from "./ChaptersPage";
import { LessonsPage } from "./LessonsPage";
import { PreparingPage } from "./PreparingPage";
import { ViewerPage } from "./ViewerPage";
import { LESSONS_HOME, LESSONS_VIEWER, lessonsUrl } from "./paths";
import { LESSONS_V2_COPY_UR as U } from "./copy";
import { kpiItems, groupByDay } from "./lessonHistory";
import { copyIn } from "../i18n";
import { LESSONS } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.clearAllMocks();
  resetLessonPlans();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
  http.get.mockImplementation(async (url: string) => {
    const data: Record<string, unknown> = {
      "/curriculum/grades": { grades: [{ grade: 4, subject_count: 4 }] },
      "/lp612/grades": { grades: [] },
      "/curriculum/subjects": { subjects: [{ subject_key: "math", subject: "Math", lesson_count: 80 }] },
      "/curriculum/chapters": { chapters: [{ chapter_number: 1, chapter_title: "Numbers", pages_label: "p.1-12", lesson_count: 9 }] },
      "/curriculum/lps": { lessons: [
        { lesson_id: "a", lp_type: "content", day_label: "Day 1", topic: "Counting", pages_label: "p.2", downloaded: true },
        { lesson_id: "w", lp_type: "assessment", day_label: null, topic: "Worksheet", downloaded: false },
      ] },
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

describe("Lesson Plans in Urdu", () => {
  it("the main page: title, Select grade and subject, Recent", async () => {
    renderAt(LESSONS_HOME, <LessonsHomePage />);
    expect(await screen.findByRole("button", { name: new RegExp(U.selectGradeSubject) })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.title);
    expect(screen.getByText(U.recent)).toBeTruthy();
    expect(screen.queryByText("Select grade and subject")).toBeNull();
  });

  it("chapters: the Chap prefix and the lessons count in Urdu", async () => {
    renderAt(lessonsUrl("chapters", { grade: 4, subject: "math" }), <ChaptersPage />);
    expect(await screen.findByText(U.chapterPrefix)).toBeTruthy();
    // The kit isolates the digits (LRI … PDI, bidi PR); compare the words without the isolates.
    const plain = (t: string | null) => (t || "").replace(/[\u2066\u2069]/g, "");
    expect(plain(screen.getByRole("link", { name: /Numbers/ }).textContent)).toContain(U.lessonsCount(9));
    expect(screen.getByText(U.grade(4))).toBeTruthy();
  });

  it("lessons: the LP # prefix and Worksheet in Urdu", async () => {
    renderAt(lessonsUrl("lessons", { grade: 4, subject: "math", chapter: "1" }), <LessonsPage />);
    expect(await screen.findByText(U.lessonPrefix)).toBeTruthy();
    expect(screen.getByText(U.worksheet)).toBeTruthy();
    expect(screen.queryByText("Worksheet")).toBeNull();
  });

  it("Preparing: its words in Urdu", () => {
    renderAt(lessonsUrl("preparing", { grade: 9, subject: "Physics", lesson: "s", render: "r", title: "Speed" }), <PreparingPage />);
    expect(screen.getByText(U.pleaseHold)).toBeTruthy();
    expect(screen.getByRole("button", { name: U.otherLessons })).toBeTruthy();
  });

  it("the viewer: Start DC observation, Answer key and Open in another app in Urdu", () => {
    renderAt(LESSONS_VIEWER, <ViewerPage />, {
      lessonPlan: { source: { lane: "k5", lessonId: "a", assetKind: "lesson" }, title: "Counting" }, dc: null,
    });
    expect(screen.getByRole("link", { name: new RegExp(U.startDc) })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.answerKey })).toBeTruthy();
    expect(screen.getByRole("button", { name: U.openOutside })).toBeTruthy();
  });

  it("All lesson plans: the tiles' labels and the day names come in the language given", () => {
    const C = copyIn(LESSONS, "ur");
    const tiles = kpiItems({ kpis: { lessonPlans: { value: 1, previous: null }, classesCovered: { value: 1, previous: null }, daysActive: { value: 1, previous: null } }, trend: { bucketDays: 1, points: [] } }, C);
    expect(tiles.map((t) => t.label)).toEqual([U.all.kpis.lessonPlans, U.all.kpis.classesCovered, U.all.kpis.daysActive]);
    const [g] = groupByDay([{ planKey: "k5:a", kind: "k5", found: true, title: "A", grade: 4, subject: "Math", subjectKey: "maths", chapterNumber: 1,
      chapterTitle: null, dayLabel: null, pagesLabel: null, lastUsedAt: "2026-10-08T04:00:00Z", day: "2026-10-08", via: "portal", open: { lane: "k5", lessonId: "a" } }], "2026-10-08", C);
    expect(g.day).toBe(U.days.today);
    expect(g.items[0].chip).toEqual({ text: U.all.opened, tone: "info" });
  });
});
