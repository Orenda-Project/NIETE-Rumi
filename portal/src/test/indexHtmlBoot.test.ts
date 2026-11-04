/**
 * bd-sex15q.34 — on a coach's or an RM's first open, the session and the flags are asked for by index.html itself,
 * before the app's first chunk has arrived (on a slow line that chunk takes seconds), and handed to the app once.
 */
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const code = doc.getElementById("coachip-boot")?.textContent ?? "";

type Boot = { config?: Promise<unknown>; me?: Promise<unknown> };
function runAt(pathname: string, opts: { native?: boolean; ok?: boolean } = {}) {
  const fetch = vi.fn((url: string) => Promise.resolve({ ok: opts.ok ?? true, json: () => Promise.resolve({ url }) }));
  const win: { __nieteBoot?: Boot; Capacitor?: unknown } = {};
  if (opts.native) win.Capacitor = { isNativePlatform: () => true };
  new Function("window", "location", "fetch", code)(win, { pathname, protocol: "https:" }, fetch);
  return { fetch, boot: win.__nieteBoot };
}

describe("index.html — the COACHIP boot reads (bd-sex15q.34)", () => {
  it("is there, as its own small script", () => {
    expect(code).toMatch(/__nieteBoot/);
  });

  it("a coach's insight page: /config and /me are asked for at once, same-origin with the cookie", async () => {
    const { fetch, boot } = runAt("/portal/coach/insights");
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(["/api/portal/config", "/api/portal/me"]);
    for (const c of fetch.mock.calls) expect((c as unknown[])[1]).toMatchObject({ credentials: "include" });
    expect(await boot!.config).toEqual({ url: "/api/portal/config" });
    expect(await boot!.me).toEqual({ url: "/api/portal/me" });
  });

  it("an RM's page: the same", () => {
    expect(runAt("/portal/rm/circle").fetch).toHaveBeenCalledTimes(2);
  });

  it("never a /coachip/ request from here (the switch is read first, by the app)", () => {
    const { fetch } = runAt("/portal/coach/insights/w/ip");
    expect(fetch.mock.calls.some((c) => String(c[0]).includes("/coachip/"))).toBe(false);
  });

  it("an answer that is not OK is handed over as null (the app then reads as before)", async () => {
    const { boot } = runAt("/portal/coach/insights", { ok: false });
    expect(await boot!.config).toBeNull();
    expect(await boot!.me).toBeNull();
  });

  it("any other page, and the Android app, ask for nothing", () => {
    for (const p of ["/", "/portal/login", "/portal/dashboard", "/portal/coach", "/portal/rmx", "/portal/teacher/home"]) {
      expect(runAt(p).fetch).not.toHaveBeenCalled();
    }
    expect(runAt("/portal/coach/insights", { native: true }).fetch).not.toHaveBeenCalled();
  });
});
