import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * bd-t5tow — the page's paper jobs. A job is tracked at page level so switching tabs never
 * stops it; it polls every 4 s for five minutes, then every 30 s marked `slow`, and NEVER
 * gives up (the old panel's 5-minute give-up is gone). Pending/failed jobs survive a refresh
 * in sessionStorage.
 */
vi.mock("../../services/api", () => ({
  portal: { generateAssessment: vi.fn(), getAssessmentStatus: vi.fn() },
}));

import { portal } from "../../services/api";
import { usePaperJobs, jobsStorageKey, type PaperJob } from "./usePaperJobs";

// M1 — jobs are stored per teacher, keyed by her phone number.
const USER = "923001234567";
const KEY = jobsStorageKey(USER);

const spec = {
  grade: 4, subject: "science", chapterNumber: 2, contentSource: "unseen" as const,
  questionCount: 15, questionTypes: [], answerLines: true, outputFormat: "pdf" as const,
};
const label = "Grade 4 Science · Plants · 15 questions";

const gen = vi.mocked(portal.generateAssessment);
const status = vi.mocked(portal.getAssessmentStatus);

/** Let the awaited promises inside the hook settle, and advance the fake clock. */
const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
  gen.mockResolvedValue({ success: true, requestId: "r1" });
  status.mockResolvedValue({ success: true, status: "generating" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function started(opts: Parameters<typeof usePaperJobs>[0] = {}) {
  const hook = renderHook(() => usePaperJobs({ userKey: USER, ...opts }));
  let result: Awaited<ReturnType<ReturnType<typeof usePaperJobs>["start"]>> | undefined;
  await act(async () => { result = await hook.result.current.start(spec, label); });
  return { hook, result: result! };
}

describe("usePaperJobs", () => {
  it("start sends the spec and adds a writing job", async () => {
    const { hook, result } = await started();
    expect(gen).toHaveBeenCalledWith(spec);
    expect(result.ok).toBe(true);
    expect(hook.result.current.jobs).toHaveLength(1);
    expect(hook.result.current.jobs[0]).toMatchObject({ requestId: "r1", spec, label, status: "writing" });
    expect(typeof hook.result.current.jobs[0].startedAt).toBe("number");
  });

  it("start returns the server's error when it refuses, and adds nothing", async () => {
    gen.mockResolvedValue({ success: false, error: "Pick a chapter" });
    const { hook, result } = await started();
    expect(result).toEqual({ ok: false, error: "Pick a chapter" });
    expect(hook.result.current.jobs).toHaveLength(0);
  });

  it("start returns the thrown response's error, as the panel showed it", async () => {
    gen.mockRejectedValue({ response: { data: { error: "Too many papers today" } } });
    const { result } = await started();
    expect(result).toEqual({ ok: false, error: "Too many papers today" });
  });

  it("ready: status ready with the paperId, and onReady is called", async () => {
    const onReady = vi.fn();
    const { hook } = await started({ onReady });
    status.mockResolvedValue({ success: true, status: "ready", paperId: "p9" });
    await tick(4000);
    expect(hook.result.current.jobs[0]).toMatchObject({ status: "ready", paperId: "p9" });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toMatchObject({ requestId: "r1", paperId: "p9", label });
    const calls = status.mock.calls.length;
    await tick(60_000);
    expect(status.mock.calls.length).toBe(calls); // stops polling once ready
  });

  it("failed: status failed with the errorCode, and onFailed is called", async () => {
    const onFailed = vi.fn();
    const { hook } = await started({ onFailed });
    status.mockResolvedValue({ success: true, status: "failed", errorCode: "NO_CONTENT" });
    await tick(4000);
    expect(hook.result.current.jobs[0]).toMatchObject({ status: "failed", errorCode: "NO_CONTENT" });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("polls every 4 s for 5 minutes, then every 30 s marked slow — and never gives up", async () => {
    const { hook } = await started();
    await tick(0);
    const first = status.mock.calls.length; // the immediate poll
    await tick(4000);
    expect(status.mock.calls.length).toBe(first + 1);
    await tick(5 * 60 * 1000);
    expect(hook.result.current.jobs[0].slow).toBe(true);
    expect(hook.result.current.jobs[0].status).toBe("writing");
    const atSlow = status.mock.calls.length;
    await tick(4000);
    expect(status.mock.calls.length).toBe(atSlow); // not 4 s any more
    await tick(26_000);
    expect(status.mock.calls.length).toBe(atSlow + 1); // 30 s
    await tick(60 * 60 * 1000); // an hour later: still checking, still writing
    expect(status.mock.calls.length).toBeGreaterThan(atSlow + 100);
    expect(hook.result.current.jobs[0].status).toBe("writing");
  });

  it("a transport error keeps waiting", async () => {
    const { hook } = await started();
    status.mockRejectedValue(new Error("network"));
    await tick(8000);
    expect(hook.result.current.jobs[0].status).toBe("writing");
    status.mockResolvedValue({ success: true, status: "ready", paperId: "p1" });
    await tick(4000);
    expect(hook.result.current.jobs[0].status).toBe("ready");
  });

  it("retry re-sends the same spec and removes the failed job", async () => {
    const { hook } = await started();
    status.mockResolvedValue({ success: true, status: "failed", errorCode: "MODEL_UNAVAILABLE" });
    await tick(4000);
    gen.mockResolvedValue({ success: true, requestId: "r2" });
    status.mockResolvedValue({ success: true, status: "generating" });
    await act(async () => { await hook.result.current.retry("r1"); });
    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen.mock.calls[1][0]).toEqual(spec);
    expect(hook.result.current.jobs.map((j) => j.requestId)).toEqual(["r2"]);
    expect(hook.result.current.jobs[0]).toMatchObject({ status: "writing", label });
  });

  it("dismiss removes the job", async () => {
    const { hook } = await started();
    status.mockResolvedValue({ success: true, status: "failed", errorCode: "NO_CONTENT" });
    await tick(4000);
    act(() => hook.result.current.dismiss("r1"));
    expect(hook.result.current.jobs).toHaveLength(0);
    expect(JSON.parse(sessionStorage.getItem(KEY) || "[]")).toHaveLength(0);
  });

  it("persists pending jobs and drops ready ones from storage", async () => {
    const { hook } = await started();
    const stored = JSON.parse(sessionStorage.getItem(KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ requestId: "r1", spec, label, status: "writing" });
    status.mockResolvedValue({ success: true, status: "ready", paperId: "p9" });
    await tick(4000);
    expect(hook.result.current.jobs[0].status).toBe("ready");
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toHaveLength(0);
  });

  it("restores jobs on mount and resumes polling the writing ones", async () => {
    const saved: PaperJob[] = [
      { requestId: "w1", spec, label, startedAt: Date.now() - 1000, status: "writing" },
      { requestId: "f1", spec, label: "Failed one", startedAt: Date.now() - 1000, status: "failed", errorCode: "NO_CONTENT" },
    ];
    sessionStorage.setItem(KEY, JSON.stringify(saved));
    status.mockResolvedValue({ success: true, status: "ready", paperId: "pw" });
    const onReady = vi.fn();
    const hook = renderHook(() => usePaperJobs({ userKey: USER, onReady }));
    expect(hook.result.current.jobs.map((j) => j.requestId)).toEqual(["w1", "f1"]);
    await tick(0);
    expect(status).toHaveBeenCalledWith("w1");
    expect(status).not.toHaveBeenCalledWith("f1");
    expect(hook.result.current.jobs[0]).toMatchObject({ status: "ready", paperId: "pw" });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("retry is guarded: a second retry of the same job while the first is in flight sends nothing (I1)", async () => {
    const { hook } = await started();
    status.mockResolvedValue({ success: true, status: "failed", errorCode: "MODEL_UNAVAILABLE" });
    await tick(4000);
    let release: (v: { success: boolean; requestId: string }) => void = () => {};
    gen.mockImplementation(() => new Promise((r) => { release = r; }));
    status.mockResolvedValue({ success: true, status: "generating" });
    let first: Promise<unknown> = Promise.resolve();
    act(() => { first = hook.result.current.retry("r1"); });
    expect(hook.result.current.retrying.has("r1")).toBe(true);
    await act(async () => { await hook.result.current.retry("r1"); });
    expect(gen).toHaveBeenCalledTimes(2); // the original + exactly one retry
    await act(async () => { release({ success: true, requestId: "r2" }); await first; });
    expect(hook.result.current.retrying.has("r1")).toBe(false);
    expect(hook.result.current.jobs.map((j) => j.requestId)).toEqual(["r2"]);
  });

  it("stores jobs per teacher: user A's jobs are not restored for user B (M1)", () => {
    const saved: PaperJob[] = [{ requestId: "a1", spec, label, startedAt: Date.now(), status: "failed", errorCode: null }];
    sessionStorage.setItem(jobsStorageKey("923000000001"), JSON.stringify(saved));
    expect(renderHook(() => usePaperJobs({ userKey: "923000000002" })).result.current.jobs).toEqual([]);
    expect(renderHook(() => usePaperJobs({ userKey: "923000000001" })).result.current.jobs.map((j) => j.requestId)).toEqual(["a1"]);
  });

  it("with no user yet, reads and writes no storage (M1)", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const hook = renderHook(() => usePaperJobs({ userKey: null }));
    await act(async () => { await hook.result.current.start(spec, label); });
    expect(hook.result.current.jobs).toHaveLength(1);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("ignores malformed storage", () => {
    sessionStorage.setItem(KEY, "{not json");
    expect(renderHook(() => usePaperJobs({ userKey: USER })).result.current.jobs).toEqual([]);
    sessionStorage.setItem(KEY, JSON.stringify([{ requestId: 5 }, "x", null]));
    expect(renderHook(() => usePaperJobs({ userKey: USER })).result.current.jobs).toEqual([]);
  });

  it("storage that throws is harmless", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { hook, result } = await started();
    expect(result.ok).toBe(true);
    expect(hook.result.current.jobs).toHaveLength(1);
  });

  it("clears its timers on unmount", async () => {
    const { hook } = await started();
    await tick(0);
    hook.unmount();
    const calls = status.mock.calls.length;
    await tick(60_000);
    expect(status.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
