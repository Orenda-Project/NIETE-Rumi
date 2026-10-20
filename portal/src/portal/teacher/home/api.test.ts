import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../../services/api";
import { fetchHome, getQuizHome, readHome, resetHomeMemo, tapHome } from "./api";

/** GET /me/home and POST /me/home/tap: the server's shape read as it is, every failure a null, never a throw. */
const ORDER = ["coaching", "lessons", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const BODY = {
  success: true, now: "2026-10-20T10:00:00Z", order: ORDER, orderOn: true,
  card: { kind: "coach_report", title: "Fractions", score: 72, at: "2026-10-18T09:00:00Z", href: "/portal/teacher/coaching/s-1", id: "s-1" },
  scores: { coach: { marks: 31, max: 40, at: "2026-10-18T09:00:00Z", id: "s-1" }, observation: { marks: 29, max: 38, at: "2026-10-12T09:00:00Z", id: "o-1" } },
  quizHome: "/quiz/teacher/abc.DEF-123",
};

describe("home api", () => {
  beforeEach(() => { vi.clearAllMocks(); resetHomeMemo(); });

  it("reads the §2.1 shape", () => {
    const d = readHome(BODY);
    expect(d?.order).toEqual(ORDER);
    expect(d?.orderOn).toBe(true);
    expect(d?.card).toMatchObject({ kind: "coach_report", title: "Fractions", id: "s-1" });
    expect(d?.scores.coach).toMatchObject({ marks: 31, max: 40, id: "s-1" });
    expect(d?.scores.observation).toEqual({ marks: 29, max: 38, at: "2026-10-12T09:00:00Z", id: "o-1" });
    expect(d?.quizHome).toBe("/quiz/teacher/abc.DEF-123");
  });

  it("an unknown rung is no card; an order that does not name every tile once is the fixed order, off", () => {
    const d = readHome({ ...BODY, card: { kind: "streak", title: "x", href: "/" }, order: ["coaching", "coaching"] });
    expect(d?.card).toBeNull();
    expect(d?.orderOn).toBe(false);
    expect(d?.order[0]).toBe("lessons");
  });

  it("a quiz home that is not a same-host quiz path is dropped", () => {
    expect(readHome({ ...BODY, quizHome: "https://evil.example/quiz/teacher/x" })?.quizHome).toBeNull();
    expect(readHome({ ...BODY, quizHome: "/portal/other" })?.quizHome).toBeNull();
  });

  it("fetchHome: 404 (the switch is off) or a failure is null, never a throw", async () => {
    vi.mocked(api.get).mockRejectedValueOnce({ response: { status: 404, data: { success: false, off: true } } });
    await expect(fetchHome()).resolves.toBeNull();
    vi.mocked(api.get).mockResolvedValueOnce({ data: { success: false } } as never);
    await expect(fetchHome()).resolves.toBeNull();
  });

  it("getQuizHome reuses the session's answer: one request", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: BODY } as never);
    await fetchHome();
    await expect(getQuizHome()).resolves.toBe("/quiz/teacher/abc.DEF-123");
    await expect(getQuizHome()).resolves.toBe("/quiz/teacher/abc.DEF-123");
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home");
  });

  it("getQuizHome with no earlier read asks once; null when there is none", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...BODY, quizHome: null } } as never);
    await expect(getQuizHome()).resolves.toBeNull();
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });

  it("tapHome posts the kind and never throws, even when the client does", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ status: 204 } as never);
    expect(() => tapHome("coach_report")).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
    expect(vi.mocked(api.post)).toHaveBeenCalledWith("/me/home/tap", { kind: "coach_report" });
    vi.mocked(api.post).mockImplementationOnce(() => { throw new Error("boom"); });
    expect(() => tapHome("lesson")).not.toThrow();
    vi.mocked(api.post).mockRejectedValueOnce(new Error("down"));
    expect(() => tapHome("class")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("tapHome settles when the post does, and resolves (never rejects) when it fails", async () => {
    let done!: (v: unknown) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((r) => { done = r; }) as never);
    let settled = false;
    const p = tapHome("class").then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    done({ status: 204 });
    await p;
    expect(settled).toBe(true);
    vi.mocked(api.post).mockRejectedValueOnce(new Error("down"));
    await expect(tapHome("lesson")).resolves.toBeUndefined();
  });
});
