import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.15 — Home's "Ready for you", from the server's list: the ready, unopened items still inside their
 * 24 weekday hours. At most 2 and "See all"; Open opens the item and tells the server; it is gone once opened.
 * Mocked at the network boundary only.
 */
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getAssessmentStatus: vi.fn(), generateAssessment: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import api from "../../services/api";
import { ReadyForYou } from "./ReadyForYou";
import { noticeTracker } from "./tracker";
import { ASSESSMENT_V2_COPY } from "../assessment/copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const USER = "923001234567";
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const paper = (id: string, over: Record<string, unknown> = {}) => ({
  id: `paper:${id}`, kind: "paper", state: "ready", title: null, grade: 4, subject: "Science", subjectKey: "science", chapterNumber: 2, questions: 15,
  startedAt: iso(-600_000), readyAt: iso(-300_000), seenAt: iso(-290_000), openedAt: null, homeUntil: iso(20 * 3_600_000),
  paperId: `pp-${id}`, renderId: null, lessonId: null, lang: null, errorCode: null, ...over,
});
const lesson = (id: string, over: Record<string, unknown> = {}) => ({
  id: `lesson:${id}`, kind: "lesson", state: "ready", title: "Speed", grade: 9, subject: "Physics", subjectKey: null, chapterNumber: null, questions: null,
  startedAt: iso(-900_000), readyAt: iso(-400_000), seenAt: iso(-390_000), openedAt: null, homeUntil: iso(20 * 3_600_000),
  paperId: null, renderId: id, lessonId: "phy9.c02.p010", lang: "en", errorCode: null, ...over,
});

let list: unknown[];
function Where() {
  const l = useLocation();
  return <span data-testid="at">{l.pathname}</span>;
}
const mount = () => render(<MemoryRouter initialEntries={["/portal/teacher"]}><ReadyForYou userKey={USER} /><Where /></MemoryRouter>);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  list = [];
  http.get.mockImplementation(async (url: string) => {
    if (url === "/me/notices") return { data: { success: true, items: list } };
    throw new Error(`unmocked ${url}`);
  });
  http.post.mockResolvedValue({ data: { success: true } });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { vi.useRealTimers(); noticeTracker.reset(); });

describe("Ready for you", () => {
  it("nothing finished for her: nothing on Home", async () => {
    mount();
    await tick(0);
    expect(screen.queryByRole("region", { name: "Ready for you" })).toBeNull();
  });

  it("a finished paper and a plan, named from what the server knows (a paper by its chapter and class)", async () => {
    list = [paper("a"), lesson("R9")];
    mount();
    await tick(0);
    const region = screen.getByRole("region", { name: "Ready for you" });
    expect(within(region).getAllByRole("button", { name: /^Open / })).toHaveLength(2);
    expect(region).toHaveTextContent("Speed");
    expect(region).toHaveTextContent("Lesson plan · Grade 9 · Physics");
    expect(region).toHaveTextContent("Paper · Grade 4 · Science");
    // A server-only paper has no title: it is named by its chapter, in the assessment's own word for it.
    expect(region).toHaveTextContent(ASSESSMENT_V2_COPY.chapterShort(2));
  });

  it("opening a paper goes to it, tells the server, and it leaves the card", async () => {
    list = [paper("a")];
    mount();
    await tick(0);
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/teacher/assessment/paper/pp-a");
    expect(http.post).toHaveBeenCalledWith("/me/notices/paper%3Aa/opened");
    expect(screen.queryByRole("region", { name: "Ready for you" })).toBeNull();
  });

  it("opening a lesson plan opens the plan viewer with what Start DC observation prefills", async () => {
    list = [lesson("R9")];
    mount();
    await tick(0);
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    await tick(0);
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/teacher/lessons/plan");
    expect(http.post).toHaveBeenCalledWith("/me/notices/lesson%3AR9/opened");
  });

  it("more than two: two rows and See all with the list", async () => {
    list = [paper("a"), paper("b"), lesson("R9")];
    mount();
    await tick(0);
    expect(within(screen.getByRole("region", { name: "Ready for you" })).getAllByRole("button", { name: /^Open / })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /See all/ }));
    expect(within(screen.getByRole("dialog")).getAllByRole("button", { name: /^Open / })).toHaveLength(3);
  });

  it("one the server lists as already opened is not shown", async () => {
    list = [paper("a", { openedAt: iso(-1000) })];
    mount();
    await tick(0);
    expect(screen.queryByRole("region", { name: "Ready for you" })).toBeNull();
  });
});
