import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportSaOffline, watchSaWorker, workerState } from "./offlineReport";

// "Get ready for offline" and the class list report what they did (sa_prep.* / sa_list.* via /funnel/sa-offline):
// fire-and-forget, never throwing into the page, and the two service workers' state read without changing them.

const nav = navigator as any;
let saved: any;
beforeEach(() => { saved = Object.getOwnPropertyDescriptor(nav, "serviceWorker"); });
afterEach(() => {
  if (saved) Object.defineProperty(nav, "serviceWorker", saved); else delete nav.serviceWorker;
  vi.unstubAllGlobals();
});
const setSw = (v: unknown) => Object.defineProperty(nav, "serviceWorker", { value: v, configurable: true });

describe("reportSaOffline", () => {
  it("posts one text/plain body to the funnel's sa-offline route, with credentials and keepalive", () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    reportSaOffline({ k: "list_late", elapsedMs: 15000, grade: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/funnel\/sa-offline$/);
    expect(init).toMatchObject({ method: "POST", credentials: "include", keepalive: true });
    expect(JSON.parse(init.body)).toMatchObject({ k: "list_late", elapsedMs: 15000, grade: 3 });
  });

  it("never throws when the send throws or rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("boom"); }));
    expect(() => reportSaOffline({ k: "list_late", elapsedMs: 1, grade: null })).not.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() => reportSaOffline({ k: "list_late", elapsedMs: 1, grade: null })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("workerState", () => {
  it("the page's controller and the engine's /sa/ registration, as paths and states", async () => {
    const reg = { active: { scriptURL: `${location.origin}/sa/sw.js`, state: "activated" }, waiting: null, installing: { state: "installing" } };
    const getRegistration = vi.fn().mockResolvedValue(reg);
    setSw({ controller: { scriptURL: `${location.origin}/assess-sw.js` }, getRegistration });
    expect(await workerState()).toEqual({
      pageSwControlled: true, pageSwScript: "/assess-sw.js", saSwScript: "/sa/sw.js", saSwActive: "activated",
      saSwWaiting: false, saSwInstalling: true, saSwUpdateFound: false,
    });
    expect(getRegistration).toHaveBeenCalledWith("/sa/");
  });

  it("no worker API, no registration, or a throwing one: a plain answer, never a throw", async () => {
    setSw(undefined);
    expect(await workerState()).toMatchObject({ pageSwControlled: false, pageSwScript: "", saSwScript: "", saSwActive: "none" });
    setSw({ controller: null, getRegistration: vi.fn().mockRejectedValue(new Error("no")) });
    expect(await workerState()).toMatchObject({ pageSwControlled: false, saSwActive: "none" });
  });

  it("watchSaWorker: an update the engine's registration finds while Get ready runs is reported", async () => {
    let onFound: () => void = () => {};
    const reg = { active: { scriptURL: `${location.origin}/sa/sw.js`, state: "activated" }, waiting: null, installing: null,
      addEventListener: vi.fn((t: string, f: () => void) => { if (t === "updatefound") onFound = f; }), removeEventListener: vi.fn() };
    setSw({ controller: null, getRegistration: vi.fn().mockResolvedValue(reg) });
    const w = watchSaWorker();
    await new Promise((r) => setTimeout(r, 0));
    expect((await w.state()).saSwUpdateFound).toBe(false);
    onFound();
    expect((await w.state()).saSwUpdateFound).toBe(true);
    w.stop();
    expect(reg.removeEventListener).toHaveBeenCalledWith("updatefound", expect.any(Function));
  });
});
