import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * bd-fmf24g.15 — the shell-level job tracker: ONE place that follows every paper and every grades 6–12
 * lesson-plan render she asked for, on whatever screen she is on. Mocked at the network boundary only
 * (the api client); the tracker, the lesson-plan client and the paper client run for real.
 */
vi.mock("../../services/api", () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    default: { get, post },
    portal: {
      getAssessmentStatus: async (id: string) => (await get(`/assessment/status/${id}`)).data,
      generateAssessment: async (spec: unknown) => (await post("/assessment/generate", spec)).data,
    },
  };
});

import api from "../../services/api";
import { createTracker, type Tracker } from "./tracker";
import { itemId, type NewNotice } from "./model";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const USER = "923001234567";

const paper = (over: Partial<NewNotice> = {}): NewNotice => ({
  kind: "paper", ref: "req1", title: "Plants and food", grade: 4, subject: "Science", questions: 15,
  waitHref: "/portal/teacher/assessment/request/req1",
  spec: { grade: 4, subject: "science", questionCount: 15 },
  ...over,
});
const lesson = (over: Partial<NewNotice> = {}): NewNotice => ({
  kind: "lesson", ref: "rend1", title: "Transport of Water", grade: 7, subject: "Science", questions: null,
  waitHref: "/portal/teacher/lessons/preparing?grade=7&subject=Science&render=rend1",
  lessonId: "seg1", lang: "en",
  ...over,
});

/** Answer the two status routes from a table the test edits as time passes. */
let paperAnswer: () => unknown;
let lessonAnswer: () => unknown;
const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

let t: Tracker;
let detach: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  paperAnswer = () => ({ success: true, status: "generating" });
  lessonAnswer = () => ({ success: true, state: "authoring" });
  http.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/assessment/status/")) return { data: paperAnswer() };
    if (url.startsWith("/lp612/status/")) return { data: lessonAnswer() };
    throw new Error(`unmocked ${url}`);
  });
  t = createTracker();
  detach = t.attach(USER);
});
afterEach(() => {
  detach();
  t.reset();
  vi.useRealTimers();
});

describe("tracking", () => {
  it("a tracked job is a making item with a stable id, and tracking it twice adds it once", () => {
    t.track(paper());
    t.track(paper());
    expect(t.getItems()).toHaveLength(1);
    expect(t.getItems()[0]).toMatchObject({
      id: itemId("paper", "req1"), kind: "paper", state: "making", title: "Plants and food", grade: 4, subject: "Science", announced: false,
    });
  });

  it("a paper that turns ready becomes ready, with where Open goes", async () => {
    t.track(paper());
    paperAnswer = () => ({ success: true, status: "ready", paperId: "p9" });
    await flush(4000);
    expect(t.getItems()[0]).toMatchObject({ state: "ready", paperId: "p9" });
    expect(t.getItems()[0].readyAt).toEqual(expect.any(Number));
  });

  it("a failed paper keeps its error code; one the server does not know is failed too", async () => {
    t.track(paper());
    paperAnswer = () => ({ success: true, status: "failed", errorCode: "MODEL_UNAVAILABLE" });
    await flush(4000);
    expect(t.getItems()[0]).toMatchObject({ state: "failed", errorCode: "MODEL_UNAVAILABLE" });
    t.settle(itemId("paper", "req1"));
    t.track(paper({ ref: "req2" }));
    paperAnswer = () => ({ success: true, status: "not_found" });
    await flush(4000);
    expect(t.getItems()[0]).toMatchObject({ state: "failed", errorCode: null });
  });

  it("a lesson plan render that is written becomes ready; a failed one fails; a still-authoring one keeps waiting", async () => {
    t.track(lesson());
    await flush(4000);
    expect(t.getItems()[0].state).toBe("making");
    lessonAnswer = () => ({ success: true, state: "ready", url: "https://r2/x.pdf" });
    await flush(4000);
    expect(t.getItems()[0].state).toBe("ready");

    t.settle(itemId("lesson", "rend1"));
    t.track(lesson({ ref: "rend2" }));
    lessonAnswer = () => ({ success: true, state: "failed" });
    await flush(4000);
    expect(t.getItems()[0].state).toBe("failed");
  });

  it("a dropped poll is not a failure: it keeps asking", async () => {
    t.track(paper());
    http.get.mockRejectedValueOnce(new Error("network"));
    await flush(4000);
    expect(t.getItems()[0].state).toBe("making");
    paperAnswer = () => ({ success: true, status: "ready", paperId: "p9" });
    await flush(4000);
    expect(t.getItems()[0].state).toBe("ready");
  });

  it("a lesson render that is no longer hers (404) is failed, as the lesson page treats it", async () => {
    t.track(lesson());
    http.get.mockRejectedValueOnce(Object.assign(new Error("404"), { response: { status: 404 } }));
    await flush(4000);
    expect(t.getItems()[0].state).toBe("failed");
  });
});

describe("polling", () => {
  it("every 4 s at first, every 15 s once it has taken 3 minutes", async () => {
    t.track(paper());
    await flush(4000);
    await flush(4000);
    const early = http.get.mock.calls.length;
    expect(early).toBe(2);
    await flush(3 * 60_000);
    const before = http.get.mock.calls.length;
    await flush(60_000);
    // one minute at 15 s is 4 asks, not 15
    expect(http.get.mock.calls.length - before).toBeLessThanOrEqual(4);
    expect(http.get.mock.calls.length - before).toBeGreaterThanOrEqual(3);
  });

  it("asks nothing while nothing is being made", async () => {
    await flush(60_000);
    expect(http.get).not.toHaveBeenCalled();
    t.track(paper());
    paperAnswer = () => ({ success: true, status: "ready", paperId: "p9" });
    await flush(4000);
    const n = http.get.mock.calls.length;
    await flush(60_000);
    expect(http.get.mock.calls.length).toBe(n);
  });

  it("asks nothing while the tab is hidden, and asks at once when it is shown again", async () => {
    t.track(paper());
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await flush(30_000);
    expect(http.get).not.toHaveBeenCalled();
    paperAnswer = () => ({ success: true, status: "ready", paperId: "p9" });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush(0);
    expect(t.getItems()[0].state).toBe("ready");
  });

  it("stops when the last screen detaches (after a short grace), and a screen that re-attaches at once does not restart it", async () => {
    t.track(paper());
    detach();
    detach = t.attach(USER); // page change: detach then attach
    await flush(4000);
    expect(http.get).toHaveBeenCalledTimes(1);
    detach();
    await flush(5000);
    const n = http.get.mock.calls.length;
    await flush(30_000);
    expect(http.get.mock.calls.length).toBe(n);
  });
});

describe("what happens once she has seen it", () => {
  it("settle removes an item; announced drops a ready one and keeps a failed one in the strip", async () => {
    t.track(paper({ ref: "ok" }));
    t.track(paper({ ref: "bad" }));
    http.get.mockImplementation(async (url: string) => ({
      data: url.endsWith("/ok") ? { success: true, status: "ready", paperId: "p1" } : { success: true, status: "failed", errorCode: "X" },
    }));
    await flush(4000);
    t.announced([itemId("paper", "ok"), itemId("paper", "bad")]);
    const left = t.getItems();
    expect(left.map((i) => i.id)).toEqual([itemId("paper", "bad")]);
    expect(left[0]).toMatchObject({ state: "failed", announced: true });
    t.settle(itemId("paper", "bad"));
    expect(t.getItems()).toEqual([]);
  });
});

describe("kept for the teacher, across a refresh", () => {
  it("a new tracker for the same teacher finds what the last one was following; another teacher does not", () => {
    t.track(paper());
    detach();
    t.reset();
    const again = createTracker();
    const off = again.attach(USER);
    expect(again.getItems().map((i) => i.id)).toEqual([itemId("paper", "req1")]);
    off();
    const other = createTracker();
    const offOther = other.attach("923009999999");
    expect(other.getItems()).toEqual([]);
    offOther();
    again.reset();
    other.reset();
  });

  it("a broken or blocked store is no reason to lose what is in memory", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(() => t.track(paper())).not.toThrow();
    expect(t.getItems()).toHaveLength(1);
    spy.mockRestore();
    localStorage.setItem(`teacher-notices:v1:${USER}`, "{not json");
    const again = createTracker();
    expect(() => again.attach(USER)()).not.toThrow();
    again.reset();
  });
});

describe("Try again", () => {
  it("a failed paper is sent again with the SAME request, tracked as a new item, and the failed one goes", async () => {
    t.track(paper());
    paperAnswer = () => ({ success: true, status: "failed", errorCode: "X" });
    await flush(4000);
    http.post.mockResolvedValue({ data: { success: true, requestId: "req2" } });
    paperAnswer = () => ({ success: true, status: "generating" });
    const res = await t.retry(itemId("paper", "req1"));
    expect(res).toEqual({ ok: true });
    expect(http.post).toHaveBeenCalledWith("/assessment/generate", { grade: 4, subject: "science", questionCount: 15 });
    expect(t.getItems().map((i) => [i.id, i.state])).toEqual([[itemId("paper", "req2"), "making"]]);
  });

  it("a refused retry keeps the failed item and says why", async () => {
    t.track(paper());
    paperAnswer = () => ({ success: true, status: "failed", errorCode: "X" });
    await flush(4000);
    http.post.mockRejectedValue({ response: { data: { error: "Too many papers today" } } });
    const res = await t.retry(itemId("paper", "req1"));
    expect(res).toEqual({ ok: false, error: "Too many papers today" });
    expect(t.getItems()[0].state).toBe("failed");
  });

  it("a failed lesson plan is asked for again (POST /lp612/request) and followed under its new render", async () => {
    t.track(lesson());
    lessonAnswer = () => ({ success: true, state: "failed" });
    await flush(4000);
    http.post.mockResolvedValue({ data: { success: true, state: "authoring", renderId: "rend2" } });
    lessonAnswer = () => ({ success: true, state: "authoring" });
    const res = await t.retry(itemId("lesson", "rend1"));
    expect(res).toEqual({ ok: true });
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "seg1", lang: "en" });
    expect(t.getItems().map((i) => [i.id, i.state])).toEqual([[itemId("lesson", "rend2"), "making"]]);
  });
});

describe("a job tracked before the shell knows whose it is", () => {
  it("is kept and is hers: a page's effect runs before the shell's, so it can be the first to speak", () => {
    const fresh = createTracker();
    fresh.track(paper());
    const off = fresh.attach(USER);
    expect(fresh.getItems().map((i) => i.id)).toEqual([itemId("paper", "req1")]);
    expect(JSON.parse(localStorage.getItem(`teacher-notices:v1:${USER}`) as string)).toHaveLength(1);
    off();
    fresh.reset();
  });
});

describe("the same job handed over twice", () => {
  it("is one item, and the later title wins (a plan's title may only be known once the catalogue answers)", () => {
    t.track(lesson({ title: "Lesson plan" }));
    t.track(lesson({ title: "Transport of Water" }));
    expect(t.getItems()).toHaveLength(1);
    expect(t.getItems()[0].title).toBe("Transport of Water");
  });
});
