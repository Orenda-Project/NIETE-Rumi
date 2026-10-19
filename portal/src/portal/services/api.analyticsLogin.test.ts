import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The API client's 401 handler on the analytics accounts' sign-in page. A signed-out visitor's session read answers
// 401, and so does a wrong account name or password: neither may throw her out to the teacher sign-in
// (/portal/login). Every other page keeps going to /portal/login as before.
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
const at = (pathname: string) => {
  loc = { pathname, href: `http://localhost${pathname}`, replace: vi.fn() };
  vi.stubGlobal("location", loc);
};

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  at("/portal/analytics/login");
  await import("./api");
});
afterEach(() => vi.unstubAllGlobals());

describe("a 401", () => {
  it.each(["/portal/analytics/login", "/portal/analytics/login/"])("on %s stays on the page", async (p) => {
    at(p);
    await expect(onError!(unauthorized())).rejects.toBeTruthy();
    expect(loc.href).toBe(`http://localhost${p}`);
    expect(loc.replace).not.toHaveBeenCalled();
  });

  it("on the analytics page itself still goes to the sign-in, as before", async () => {
    at("/portal/analytics/schools");
    await expect(onError!(unauthorized())).rejects.toBeTruthy();
    expect(loc.href).toBe("/portal/login");
  });

  it("on the teacher sign-in stays there, as before", async () => {
    at("/portal/login");
    await expect(onError!(unauthorized())).rejects.toBeTruthy();
    expect(loc.href).toBe("http://localhost/portal/login");
  });
});
