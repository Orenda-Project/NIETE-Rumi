import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// bd-v0toag.31 final review I-1 — Record must not wait on the eligibility hop for groups A/B/C.
// Coaching asks on mount; Record uses the last answer at once and waits (≤1.5 s) only with none yet.

const api = vi.hoisted(() => ({ liveEligible: vi.fn() }));
vi.mock("../../services/api", () => ({ portal: api }));

import { prefetchLiveEligible, liveEligibleNow, forgetLiveEligible } from "./liveEligible";

const never = () => new Promise(() => {});

beforeEach(() => { forgetLiveEligible(); api.liveEligible.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("liveEligible", () => {
  it("a settled answer is used at once, with no second wait", async () => {
    api.liveEligible.mockResolvedValue({ on: false });
    expect(await prefetchLiveEligible()).toBe(false);
    api.liveEligible.mockImplementation(never);
    vi.useFakeTimers();
    let got: boolean | undefined;
    void liveEligibleNow().then((v) => { got = v; });
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toBe(false);
  });

  it("a settled yes is used at once", async () => {
    api.liveEligible.mockResolvedValue({ on: true });
    await prefetchLiveEligible();
    expect(await liveEligibleNow()).toBe(true);
  });

  it("with no answer yet, waits 1.5 s then says off", async () => {
    api.liveEligible.mockImplementation(never);
    vi.useFakeTimers();
    let got: boolean | undefined;
    void liveEligibleNow().then((v) => { got = v; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toBe(false);
  });

  it("a failure says off, and the next prefetch asks again", async () => {
    api.liveEligible.mockRejectedValue(new Error("502"));
    expect(await prefetchLiveEligible()).toBe(false);
    api.liveEligible.mockResolvedValue({ on: true });
    expect(await prefetchLiveEligible()).toBe(true);
    expect(await liveEligibleNow()).toBe(true);
    expect(api.liveEligible).toHaveBeenCalledTimes(2);
  });

  it("a prefetch already on its way is shared, not repeated", async () => {
    api.liveEligible.mockResolvedValue({ on: true });
    await Promise.all([prefetchLiveEligible(), prefetchLiveEligible()]);
    expect(api.liveEligible).toHaveBeenCalledTimes(1);
  });

  it("a missing api function is off, not a throw", async () => {
    api.liveEligible.mockImplementation(() => { throw new Error("not a function"); });
    expect(await prefetchLiveEligible()).toBe(false);
  });
});
