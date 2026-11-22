import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * The "Make a quiz on today's lesson" card in Home's "Ready for you": the server lists a `quiz_offer` item when the
 * WhatsApp quiz offer or coaching ask was skipped today because the teacher's window was shut (behind its server switch).
 * Drawn only when the session has a quiz home to open; the tap tells the server and opens that quiz home (the
 * existing maker). No quiz_offer item: nothing new is asked (GET /me/home is not called from here).
 * Mocked at the network boundary only.
 */
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getAssessmentStatus: vi.fn(), generateAssessment: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import api from "../../services/api";
import { ReadyForYou } from "./ReadyForYou";
import { noticeTracker } from "./tracker";
import { resetHomeMemo } from "../home/api";
import { NOTICES_COPY, NOTICES_COPY_UR } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const USER = "923001234567";
const NUDGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const quizOffer = (over: Record<string, unknown> = {}) => ({
  id: `quiz_offer:${NUDGE}`, kind: "quiz_offer", state: "ready", title: "Comparing fractions", grade: 4, subject: "Maths",
  subjectKey: null, chapterNumber: null, questions: null, startedAt: iso(-600_000), readyAt: iso(-600_000), seenAt: null,
  openedAt: null, homeUntil: iso(6 * 3_600_000), paperId: null, renderId: null, lessonId: "m4.c03.l02", lang: null,
  errorCode: null, nudgeId: NUDGE, from: "lp_quiz_offer", ...over,
});
const paper = () => ({
  id: "paper:a", kind: "paper", state: "ready", title: null, grade: 4, subject: "Science", subjectKey: "science", chapterNumber: 2, questions: 15,
  startedAt: iso(-700_000), readyAt: iso(-300_000), seenAt: iso(-290_000), openedAt: null, homeUntil: iso(20 * 3_600_000),
  paperId: "pp-a", renderId: null, lessonId: null, lang: null, errorCode: null,
});

let list: unknown[];
let home: unknown;
const assign = vi.fn();
const mount = () => render(<MemoryRouter initialEntries={["/portal/teacher"]}><ReadyForYou userKey={USER} /></MemoryRouter>);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  resetHomeMemo();
  list = [];
  home = { success: true, quizHome: "/quiz/teacher/tok", order: [], card: null, scores: {} };
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
  http.get.mockImplementation(async (url: string) => {
    if (url === "/me/notices") return { data: { success: true, items: list } };
    if (url === "/me/home") {
      if (home === 404) throw Object.assign(new Error("404"), { response: { status: 404 } });
      return { data: home };
    }
    throw new Error(`unmocked ${url}`);
  });
  http.post.mockResolvedValue({ data: { success: true } });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { vi.useRealTimers(); noticeTracker.reset(); resetHomeMemo(); });

describe("Ready for you: the quiz card", () => {
  it("a quiz_offer item and a quiz home: one row naming the lesson, beside the teacher's other items", async () => {
    list = [quizOffer(), paper()];
    mount();
    await tick(0);
    const region = screen.getByRole("region", { name: "Ready for you" });
    expect(within(region).getAllByRole("button", { name: /^Open / })).toHaveLength(2);
    expect(region).toHaveTextContent(NOTICES_COPY.quizOfferTitle);
    expect(region).toHaveTextContent("Comparing fractions");
  });

  it("the tap tells the server (opened) and opens the quiz home the app already has", async () => {
    list = [quizOffer()];
    mount();
    await tick(0);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(NOTICES_COPY.quizOfferTitle.replace(/[.*+?^${}()|[\]\\']/g, ".")) }));
    expect(http.post).toHaveBeenCalledWith(`/me/notices/quiz_offer%3A${NUDGE}/opened`);
    await tick(500);
    expect(assign).toHaveBeenCalledWith("/quiz/teacher/tok");
  });

  it("no topic known (the coaching ask's row): the card still says what it is, with no invented topic", async () => {
    list = [quizOffer({ title: null, grade: null, subject: null, from: "coaching_after_lp" })];
    mount();
    await tick(0);
    const region = screen.getByRole("region", { name: "Ready for you" });
    expect(region).toHaveTextContent(NOTICES_COPY.quizOfferTitle);
    expect(region).toHaveTextContent(NOTICES_COPY.quizOfferToday);
  });

  it("in Urdu, the Urdu words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    list = [quizOffer()];
    mount();
    await tick(0);
    expect(document.body).toHaveTextContent(NOTICES_COPY_UR.quizOfferTitle);
  });

  it("in Urdu, an English topic with a comma stays ONE run, in its own order (never split at the comma)", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    const topic = "Skip Counting in 5s, 10s and 100s";
    list = [quizOffer({ title: topic })];
    mount();
    await tick(0);
    const text = document.body.textContent || "";
    expect(text).toContain(`⁦${topic}⁩`);
    expect(text).not.toContain("5s⁩,");
  });

  it("in Urdu, an Urdu topic is left as it is (no isolate around it)", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    list = [quizOffer({ title: "نئے الفاظ اور ارکان سازی" })];
    mount();
    await tick(0);
    const text = document.body.textContent || "";
    expect(text).toContain("نئے الفاظ اور ارکان سازی");
    expect(text).not.toContain("⁦نئے");
  });

  it("no quiz home for this session (GET /me/home off): the card is not drawn — never a dead button", async () => {
    home = 404;
    list = [quizOffer()];
    mount();
    await tick(0);
    expect(screen.queryByRole("region", { name: "Ready for you" })).toBeNull();
  });

  it("no quiz_offer item: GET /me/home is not asked from here (Home as today)", async () => {
    list = [paper()];
    mount();
    await tick(0);
    expect(http.get.mock.calls.map((c) => c[0])).not.toContain("/me/home");
  });
});
