import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

/**
 * bd-5rz1v.12 — useNewUi() reads features.newUi from /config the way the other
 * portal flags are read (useChildTest, useSelfObservation): null while loading,
 * then true only for a real `true`; anything else, a failed read, or a client
 * that throws is OFF.
 *
 * It also remembers the last answer for the same user, so a pilot user moving
 * between pages (every page mounts its own layout and navigation) does not see
 * the old menu flash before the new one on every tap.
 */

vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { portal } from "../services/api";
import { useNewUi, resetNewUiMemory } from "./useNewUi";

const getConfig = vi.mocked(portal.getConfig);
const answer = (features: Record<string, unknown>) => getConfig.mockResolvedValue({ success: true, features } as never);

beforeEach(() => {
  getConfig.mockReset();
  resetNewUiMemory();
});

describe("useNewUi", () => {
  it("is null while /config is being read", () => {
    getConfig.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useNewUi("u1"));
    expect(result.current).toBeNull();
  });

  it("is true when /config says newUi: true", async () => {
    answer({ newUi: true });
    const { result } = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ["false", { newUi: false }],
    ["absent", {}],
    ['the string "true"', { newUi: "true" }],
    ["1", { newUi: 1 }],
  ])("is false when newUi is %s", async (_label, features) => {
    answer(features);
    const { result } = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is false when /config fails", async () => {
    getConfig.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is false when the client throws synchronously", async () => {
    getConfig.mockImplementation(() => { throw new Error("boom"); });
    const { result } = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("does not read until told it is ready (the layout waits for the user)", async () => {
    answer({ newUi: true });
    const { result, rerender } = renderHook(({ ready }) => useNewUi("u1", ready), { initialProps: { ready: false } });
    await act(async () => { await Promise.resolve(); });
    expect(getConfig).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    rerender({ ready: true });
    await waitFor(() => expect(result.current).toBe(true));
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("two readers mounting together share one /config read", async () => {
    answer({ newUi: true });
    const a = renderHook(() => useNewUi("u1"));
    const b = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(a.result.current).toBe(true));
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("starts from the last answer for the same user, so pages do not flash the old menu", async () => {
    answer({ newUi: true });
    const first = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();

    getConfig.mockImplementation(() => new Promise(() => {}));
    const again = renderHook(() => useNewUi("u1"));
    expect(again.result.current).toBe(true);
  });

  it("never carries one user's answer to another user", async () => {
    answer({ newUi: true });
    const first = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();

    getConfig.mockImplementation(() => new Promise(() => {}));
    const other = renderHook(() => useNewUi("u2"));
    expect(other.result.current).toBeNull();
  });

  it("a fresh 'off' replaces a remembered 'on'", async () => {
    answer({ newUi: true });
    const first = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();

    answer({ newUi: false });
    const again = renderHook(() => useNewUi("u1"));
    await waitFor(() => expect(again.result.current).toBe(false));
    await act(async () => { await Promise.resolve(); });
    const third = renderHook(() => useNewUi("u1"));
    expect(third.result.current).toBe(false);
  });
});
