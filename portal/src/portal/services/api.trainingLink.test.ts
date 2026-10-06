import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The API client's 401 handler. A session from the training link (remembered
// for this tab once /dashboard said sessionScope 'training') that runs out goes
// to the link page (/t: "open Training again in WhatsApp"); any other session
// goes to the password login as before.
let onError: ((e: unknown) => Promise<unknown>) | null = null;
vi.mock("axios", () => {
  const instance = {
    interceptors: { response: { use: (_ok: unknown, err: (e: unknown) => Promise<unknown>) => { onError = err; } } },
    get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  };
  return { default: { create: () => instance } };
});

const unauthorized = () => ({ response: { status: 401 } });

let loc: { pathname: string; href: string; replace: ReturnType<typeof vi.fn> };
beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  loc = { pathname: "/portal/training/unit/m-1", href: "http://localhost/portal/training/unit/m-1", replace: vi.fn() };
  vi.stubGlobal("location", loc);
  await import("./api");
});
afterEach(() => vi.unstubAllGlobals());

describe("a 401", () => {
  it("from a training-link session goes to the link page", async () => {
    const { rememberLinkSession } = await import("../lib/trainingLinkSession");
    rememberLinkSession(true);
    await expect(onError!(unauthorized())).rejects.toBeTruthy();
    expect(loc.replace).toHaveBeenCalledWith("/t");
    expect(loc.href).not.toBe("/portal/login");
  });

  it("from any other session still goes to the password login", async () => {
    await expect(onError!(unauthorized())).rejects.toBeTruthy();
    expect(loc.href).toBe("/portal/login");
    expect(loc.replace).not.toHaveBeenCalled();
  });
});
