/**
 * bd-sex15q.34 (COS 105750) — the app's first chunk, on a coach's first open of This week: /coachip/home starts as
 * soon as /config says the switch is on, and the page takes that request once. A switch-off coach: zero /coachip/.
 * Runs App.tsx's own boot line (imported fresh per case, at the coach's path).
 */
import { vi } from "vitest";

const { get, getConfig } = vi.hoisted(() => ({ get: vi.fn(), getConfig: vi.fn() }));
vi.mock("@/portal/services/api", async (orig) => {
  const real = await orig<typeof import("@/portal/services/api")>();
  return { ...real, default: { ...real.default, get, post: vi.fn() }, portal: { ...real.portal, getConfig } };
});

// Importing the whole app takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

const coachipCalls = () => get.mock.calls.filter((c) => String(c[0]).startsWith("/coachip/"));

async function bootAt(path: string, coachip: unknown) {
  vi.resetModules();
  get.mockReset();
  get.mockImplementation((url: string) => Promise.resolve({ data: { url } }));
  getConfig.mockReset();
  getConfig.mockResolvedValue({ success: true, features: { coachip } });
  window.history.pushState({}, "", path);
  await import("@/App");
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  const { coachip: client } = await import("@/portal/coach/insights/api");
  return client;
}

describe("App boot: This week's data (bd-sex15q.34)", () => {
  it("switch on: /coachip/home once at boot, and the page's read takes it", async () => {
    const client = await bootAt("/portal/coach/insights", true);
    expect(coachipCalls().map((c) => c[0])).toEqual(["/coachip/home"]);
    expect(await client.home()).toEqual({ url: "/coachip/home" });
    expect(coachipCalls()).toHaveLength(1);
    await client.home();
    expect(coachipCalls()).toHaveLength(2);
  });

  it("switch off (or anything but a literal true): zero /coachip/ requests", async () => {
    for (const v of [false, undefined, "true"]) {
      await bootAt("/portal/coach/insights", v);
      expect(coachipCalls()).toHaveLength(0);
    }
  });

  it("any other page: zero /coachip/ requests", async () => {
    await bootAt("/portal/coach", true);
    expect(coachipCalls()).toHaveLength(0);
  });
});
