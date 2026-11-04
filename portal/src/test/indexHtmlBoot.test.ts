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

type Boot = { config?: Promise<unknown>; me?: Promise<unknown>; home?: Promise<unknown>; language?: Promise<unknown>; done?: Record<string, unknown> };
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

describe("index.html — the teacher Home's boot reads (bd-1q4z4o)", () => {
  it("/portal/teacher (where WhatsApp's link lands): /config, /me and /me/home are asked for at once, with the cookie", async () => {
    for (const p of ["/portal/teacher", "/portal/teacher/"]) {
      const { fetch, boot } = runAt(p);
      expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(["/api/portal/config", "/api/portal/me", "/api/portal/me/home", "/api/portal/me/language"]);
      for (const c of fetch.mock.calls) expect((c as unknown[])[1]).toMatchObject({ credentials: "include" });
      expect(await boot!.home).toEqual({ url: "/api/portal/me/home" });
    }
  });

  it("each answer is also kept as it arrives, so the app can draw with it at once (peekBoot)", async () => {
    const { boot } = runAt("/portal/teacher");
    await boot!.home;
    await new Promise((r) => setTimeout(r, 0));
    expect(boot!.done).toMatchObject({ home: { url: "/api/portal/me/home" }, config: { url: "/api/portal/config" } });
  });

  it("an answer that is not OK is not kept (the app asks again)", async () => {
    const { boot } = runAt("/portal/teacher", { ok: false });
    expect(await boot!.home).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(boot!.done).toEqual({});
  });

  it("a coach page never asks for /me/home; a teacher feature page asks for nothing", () => {
    expect(runAt("/portal/coach/insights").fetch.mock.calls.some((c) => String(c[0]).includes("/me/home"))).toBe(false);
    for (const p of ["/portal/teacher/lessons", "/portal/teacherx"]) expect(runAt(p).fetch).not.toHaveBeenCalled();
    expect(runAt("/portal/teacher", { native: true }).fetch).not.toHaveBeenCalled();
  });
});

describe("index.html — the teacher Home asks for her language too (bd-43f1sk)", () => {
  it("/portal/teacher: /me/language is read with the page, so the app can draw her language first", async () => {
    const { boot } = runAt("/portal/teacher");
    expect(await boot!.language).toEqual({ url: "/api/portal/me/language" });
  });

  it("a coach page does not ask for it", () => {
    expect(runAt("/portal/coach/insights").fetch.mock.calls.some((c) => String(c[0]).includes("/me/language"))).toBe(false);
  });
});

describe("index.html — an Urdu teacher's font starts downloading with her language (bd-43f1sk)", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
  const nastaliq = (css.match(/font-family:\s*"NIETE Nastaliq";[\s\S]*?url\(([^)]+)\)/) || [])[1]?.replace(/["']/g, "");

  function runWithLanguage(language: string) {
    const fetch = vi.fn((url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve(url.endsWith("/me/language") ? { success: true, language } : { url }) }));
    const win: { __nieteBoot?: Boot } = {};
    new Function("window", "location", "fetch", code)(win, { pathname: "/portal/teacher", protocol: "https:" }, fetch);
    return win.__nieteBoot!;
  }
  const preloads = () => [...document.head.querySelectorAll('link[rel="preload"][as="font"]')] as HTMLLinkElement[];
  afterEach(() => preloads().forEach((l) => l.remove()));

  it("index.css's Urdu face is the file index.html preloads (one URL, kept in step)", () => {
    expect(nastaliq).toMatch(/^https:\/\/fonts\.gstatic\.com\/.+\.woff2$/);
    expect(code).toContain(nastaliq);
  });

  it("Urdu: a font preload for that file, cross-origin, as soon as /me/language answers", async () => {
    const boot = runWithLanguage("ur");
    await boot.language;
    await new Promise((r) => setTimeout(r, 0));
    const l = preloads();
    expect(l).toHaveLength(1);
    expect(l[0].href).toBe(nastaliq);
    expect(l[0].crossOrigin).toBe("anonymous");
    expect(l[0].type).toBe("font/woff2");
  });

  it("English: no font preload", async () => {
    const boot = runWithLanguage("en");
    await boot.language;
    await new Promise((r) => setTimeout(r, 0));
    expect(preloads()).toHaveLength(0);
  });
});
