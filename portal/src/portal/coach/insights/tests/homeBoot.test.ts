/**
 * bd-sex15q.34 — This week's /coachip/home can start at boot, once the switch is known to be on, and the page takes
 * that request once. COS 105750: a switch-off coach still makes zero /coachip/ requests.
 */
import { vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../services/api", () => ({ default: { get, post: vi.fn() } }));

import { coachip, forgetPrimedHome, primeHome, primeHomeWhenOn } from "../api";

describe("the boot /coachip/home", () => {
  beforeEach(() => {
    forgetPrimedHome();
    get.mockReset();
    get.mockImplementation((url: string) => Promise.resolve({ data: { url, n: get.mock.calls.length } }));
  });

  it("a primed request is taken by the page once; the next read asks again", async () => {
    primeHome();
    expect(get).toHaveBeenCalledTimes(1);
    expect(await coachip.home()).toEqual({ url: "/coachip/home", n: 1 });
    expect(get).toHaveBeenCalledTimes(1);
    await coachip.home();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("nothing primed: as before", async () => {
    await coachip.home();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("a primed request older than 30 s is not used", async () => {
    vi.useFakeTimers();
    try {
      primeHome();
      vi.advanceTimersByTime(30_001);
      await coachip.home();
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("primed only when /config says the switch is on (a literal true)", async () => {
    for (const [cfg, n] of [[{ features: { coachip: true } }, 1], [{ features: { coachip: false } }, 0], [{ features: {} }, 0], [null, 0], [{ features: { coachip: "true" } }, 0]] as const) {
      forgetPrimedHome();
      get.mockClear();
      await primeHomeWhenOn(() => Promise.resolve(cfg));
      expect(get.mock.calls.filter((c) => String(c[0]).includes("/coachip/")).length).toBe(n);
    }
  });

  it("an unreadable /config: no /coachip/ request", async () => {
    await primeHomeWhenOn(() => Promise.reject(new Error("offline")));
    expect(get).not.toHaveBeenCalled();
  });
});
