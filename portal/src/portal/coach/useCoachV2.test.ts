import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { portal } from "../services/api";
import { useCoachV2, isCoachV2For, resetCoachV2Memory } from "./useCoachV2";

/**
 * bd-o15qnr — is the coach app v2 on for this user? Read like useNewUi: null
 * while /config loads, then true only for a real `true`. Fail-closed.
 */
describe("useCoachV2", () => {
  beforeEach(() => { vi.clearAllMocks(); resetCoachV2Memory(); });

  it("true only when /config says coachV2: true", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { coachV2: true } } as never);
    const { result } = renderHook(() => useCoachV2("923001234567"));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ["false", { coachV2: false }],
    ["absent", {}],
    ["a string", { coachV2: "true" }],
  ])("%s is off", async (_l, features) => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
    const { result } = renderHook(() => useCoachV2("923001234567"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("a failed read is off", async () => {
    vi.mocked(portal.getConfig).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useCoachV2("923001234567"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("remembers the last answer for the same user, never for another", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { coachV2: true } } as never);
    const first = renderHook(() => useCoachV2("923001234567"));
    await waitFor(() => expect(first.result.current).toBe(true));
    vi.mocked(portal.getConfig).mockImplementation(() => new Promise(() => {}));
    expect(renderHook(() => useCoachV2("923001234567")).result.current).toBe(true);
    expect(renderHook(() => useCoachV2("923009999999")).result.current).toBeNull();
  });
});

describe("isCoachV2For — only a coach gets v2", () => {
  it("a coach with the flag", () => expect(isCoachV2For({ role: "coach" }, true)).toBe(true));
  it("a coach, flag off or loading", () => {
    expect(isCoachV2For({ role: "coach" }, false)).toBe(false);
    expect(isCoachV2For({ role: "coach" }, null)).toBe(false);
  });
  it.each(["teacher", "principal", "aeo", "supervisor", "school_leader", null])("role %s with the flag: no", (role) => {
    expect(isCoachV2For({ role }, true)).toBe(false);
  });
  it("role is read case- and space-insensitively", () => expect(isCoachV2For({ role: " Coach " }, true)).toBe(true));
});
