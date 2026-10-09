import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { portal } from "../services/api";
import { useTeacherV2, isTeacherV2For, resetTeacherV2Memory } from "./useTeacherV2";

/**
 * bd-fmf24g.1 — is the teacher app v2 on for this user? Read like useCoachV2:
 * null while /config loads, then true only for a real `true`. Fail-closed.
 */
describe("useTeacherV2", () => {
  beforeEach(() => { vi.clearAllMocks(); resetTeacherV2Memory(); });

  it("true only when /config says teacherV2: true", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { teacherV2: true } } as never);
    const { result } = renderHook(() => useTeacherV2("923001234567"));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ["false", { teacherV2: false }],
    ["absent", {}],
    ["a string", { teacherV2: "true" }],
    ["only the coach v2 flag", { coachV2: true }],
  ])("%s is off", async (_l, features) => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
    const { result } = renderHook(() => useTeacherV2("923001234567"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("a failed read is off", async () => {
    vi.mocked(portal.getConfig).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useTeacherV2("923001234567"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("waits while not ready", () => {
    const { result } = renderHook(() => useTeacherV2("923001234567", false));
    expect(result.current).toBeNull();
    expect(portal.getConfig).not.toHaveBeenCalled();
  });

  it("remembers the last answer for the same user, never for another", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { teacherV2: true } } as never);
    const first = renderHook(() => useTeacherV2("923001234567"));
    await waitFor(() => expect(first.result.current).toBe(true));
    vi.mocked(portal.getConfig).mockImplementation(() => new Promise(() => {}));
    expect(renderHook(() => useTeacherV2("923001234567")).result.current).toBe(true);
    expect(renderHook(() => useTeacherV2("923009999999")).result.current).toBeNull();
  });
});

describe("isTeacherV2For — teachers only, never the leader family", () => {
  it("a teacher with the flag", () => expect(isTeacherV2For({ role: "teacher" }, true)).toBe(true));
  it("no role recorded, with the flag (the pilot list already names her)", () => {
    expect(isTeacherV2For({ role: null }, true)).toBe(true);
  });
  it("a teacher, flag off or loading", () => {
    expect(isTeacherV2For({ role: "teacher" }, false)).toBe(false);
    expect(isTeacherV2For({ role: "teacher" }, null)).toBe(false);
  });
  it.each(["coach", "principal", "aeo", "supervisor", "school_leader", " Coach "])("role %s with the flag: no", (role) => {
    expect(isTeacherV2For({ role }, true)).toBe(false);
  });
  it("no user: no", () => expect(isTeacherV2For(null, true)).toBe(false));
});
