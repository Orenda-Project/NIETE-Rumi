import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-fmf24g.15 — where the pages hand a job to the shell, and what the two waiting pages now say.
 *
 *   Check and make   a paper she just asked for is followed from the shell (title, class, the request that
 *                    makes it again), whatever page she goes to next;
 *   Try again        a paper made again is followed under its new request; Dismiss lets the old one go;
 *   Preparing        a grades 6–12 plan being written is followed from the shell, however she reached the page;
 *   both pages       "You can leave. We'll tell you here." (the paper page's "Safe to leave" chip is replaced by it;
 *                    the plan page no longer says "Opens by itself": banned, the plan still opens by itself).
 */
const { portal } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(), getAssessmentChapters: vi.fn(), generateAssessment: vi.fn(), getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(), getAssessmentDownload: vi.fn(), getAssessmentVersions: vi.fn(),
  },
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock("../../lib/useNewUi", () => ({ readConfigShared: () => Promise.resolve({ features: { assessmentGenerator: true, assessmentEditing: true } }) }));
vi.mock("../../lib/gradeSubjects", () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { forgetCatalogue } from "../assessment/api";
import { forgetPapers } from "../assessment/paperCache";
import { clearPicksForTest, setPicks } from "../assessment/store";
import { newPicks } from "../assessment/model";
import { CheckStep } from "../assessment/NewPaperSteps";
import { RequestPage } from "../assessment/RequestPage";
import { ASSESSMENT_V2_BASE, newPaperPath, requestPath } from "../assessment/paths";
import { PreparingPage } from "../lessons/PreparingPage";
import { lessonsUrl } from "../lessons/paths";
import { noticeTracker } from "./tracker";
import { itemId } from "./model";
import { NOTICES } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const L = NOTICES.en;

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}{l.search}</output>;
}
const at = (path: string, routePath: string, el: JSX.Element) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path={routePath} element={el} />
      <Route path="*" element={null} />
    </Routes>
    <Where />
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  noticeTracker.reset();
  noticeTracker.attach("923001234567");
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  resetLessonPlans();
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => (grade && subject
    ? { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, types: [{ id: "MCQs", category: "objective" }] }
    : { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, subjects: [{ subject_key: "science", subject: "Science" }] }));
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: [
    { chapter_number: 1, chapter_title: "Green Guardians of Earth", page_start: 1, page_end: 28, page_count: 28 },
  ] });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: "queued" });
  http.get.mockResolvedValue({ data: { success: true, state: "authoring" } });
});

describe("a paper she just asked for", () => {
  it("is followed from the shell, with its title, class and the request that makes it again", async () => {
    setPicks({ ...newPicks(15), grade: 4, subject: "science", subjectName: "Science", chapters: [1] });
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: "req-9" });
    at(newPaperPath("check"), newPaperPath("check"), <CheckStep />);
    fireEvent.click(await screen.findByRole("button", { name: /Make my paper/ }));
    await waitFor(() => expect(noticeTracker.getItems()).toHaveLength(1));
    expect(noticeTracker.getItems()[0]).toMatchObject({
      id: itemId("paper", "req-9"), kind: "paper", state: "making", title: "Green Guardians of Earth",
      grade: 4, subject: "Science", questions: 15, waitHref: requestPath("req-9"),
      spec: expect.objectContaining({ grade: 4, subject: "science", questionCount: 15 }),
    });
  });

  it("a request the server refuses is not followed", async () => {
    setPicks({ ...newPicks(15), grade: 4, subject: "science", subjectName: "Science", chapters: [1] });
    portal.generateAssessment.mockRejectedValue({ response: { data: { error: "Leave room for new questions." } } });
    at(newPaperPath("check"), newPaperPath("check"), <CheckStep />);
    fireEvent.click(await screen.findByRole("button", { name: /Make my paper/ }));
    await screen.findByRole("alert");
    expect(noticeTracker.getItems()).toEqual([]);
  });
});

describe("the paper page", () => {
  const job = (status: string, extra: object = {}) => sessionStorage.setItem("assessment-jobs:v1:923001234567", JSON.stringify([{
    requestId: "req-1", label: "Green Guardians of Earth", startedAt: Date.now(), status,
    spec: { grade: 4, subject: "science", questionCount: 15 }, ...extra,
  }]));

  it("writing: 'You can leave. We'll tell you here.' replaces the 'Safe to leave' chip", async () => {
    job("writing");
    at(requestPath("req-1"), `${ASSESSMENT_V2_BASE}/request/:requestId`, <RequestPage />);
    expect(await screen.findByText(L.leave)).toBeInTheDocument();
    expect(screen.queryByText("Safe to leave")).toBeNull();
  });

  it("Try again follows the new request; Dismiss lets the old failed one go from the strip", async () => {
    job("failed", { errorCode: "TRUNCATED" });
    noticeTracker.track({
      kind: "paper", ref: "req-1", title: "Green Guardians of Earth", grade: 4, subject: "Science", questions: 15,
      waitHref: requestPath("req-1"), spec: { grade: 4, subject: "science", questionCount: 15 },
    });
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: "req-2" });
    at(requestPath("req-1"), `${ASSESSMENT_V2_BASE}/request/:requestId`, <RequestPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(noticeTracker.getItems().map((i) => i.id)).toContain(itemId("paper", "req-2")));
    expect(noticeTracker.getItems().map((i) => i.id)).not.toContain(itemId("paper", "req-1"));
  });

  it("Dismiss on a failed paper removes it from the shell too", async () => {
    job("failed", { errorCode: "TRUNCATED" });
    noticeTracker.track({
      kind: "paper", ref: "req-1", title: "x", grade: 4, subject: "Science", questions: 15,
      waitHref: requestPath("req-1"), spec: {},
    });
    at(requestPath("req-1"), `${ASSESSMENT_V2_BASE}/request/:requestId`, <RequestPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Dismiss/ }));
    expect(noticeTracker.getItems()).toEqual([]);
  });
});

describe("the lesson plan page", () => {
  const AT = { grade: 7, subject: "Science", key: "science", chapter: "c02", lesson: "seg1", render: "R7", title: "Transport of Water" };

  it("a plan being written is followed from the shell, whichever way she reached the page", async () => {
    at(lessonsUrl("preparing", AT), lessonsUrl("preparing", AT).split("?")[0], <PreparingPage />);
    await waitFor(() => expect(noticeTracker.getItems()).toHaveLength(1));
    expect(noticeTracker.getItems()[0]).toMatchObject({
      id: itemId("lesson", "R7"), kind: "lesson", state: "making", title: "Transport of Water", grade: 7, subject: "Science",
      lessonId: "seg1", waitHref: lessonsUrl("preparing", AT),
    });
  });

  it("'You can leave. We'll tell you here.' and no 'Opens by itself' chip", async () => {
    at(lessonsUrl("preparing", AT), lessonsUrl("preparing", AT).split("?")[0], <PreparingPage />);
    expect(await screen.findByText(L.leave)).toBeInTheDocument();
    expect(screen.queryByText("Opens by itself")).toBeNull();
  });
});
