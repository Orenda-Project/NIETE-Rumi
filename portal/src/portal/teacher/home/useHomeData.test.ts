import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), fetchHome: vi.fn(), tapHome: vi.fn() }));
vi.mock("../../lib/useNewUi", () => ({ readConfigShared: vi.fn() }));
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { fetchHome, tapHome, type HomeData } from "./api";
import { readConfigShared } from "../../lib/useNewUi";
import { REORDER_BUDGET_MS, TAP_WAIT_MS, resetHomeLookMemory, resetHomeOrderMemory, useHomeData, useHomeGo, useHomeLook, useHomeSwitches } from "./useHomeData";

/**
 * The Home card's loading rule: one request; the tiles keep the order they painted unless the fetched order lands
 * within the 300 ms budget and before her first interaction; a late order is the next load's starting order.
 */
const ORDER = ["coaching", "lessons", "training", "observations", "assessment", "attendance", "classes", "analytics"] as HomeData["order"];
const DATA: HomeData = { now: "", order: ORDER, orderOn: true, card: null, scores: { coach: null, observation: null }, quizHome: null };

function deferred() {
  let resolve!: (v: HomeData | null) => void;
  const p = new Promise<HomeData | null>((r) => { resolve = r; });
  return { p, resolve };
}

describe("useHomeData", () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.clearAllMocks();
    resetHomeOrderMemory();
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("off: no request, no order", () => {
    const { result } = renderHook(() => useHomeData(false, true, "k"));
    expect(fetchHome).not.toHaveBeenCalled();
    expect(result.current).toEqual({ data: null, order: null });
  });

  it("an order that lands within the budget is applied; one request", async () => {
    vi.mocked(fetchHome).mockResolvedValue(DATA);
    const { result } = renderHook(() => useHomeData(true, true, "k"));
    await waitFor(() => expect(result.current.order).toEqual(ORDER));
    expect(fetchHome).toHaveBeenCalledTimes(1);
  });

  it("a late order keeps this load's fixed order, and is the next load's starting order", async () => {
    const d = deferred();
    vi.mocked(fetchHome).mockReturnValue(d.p);
    const { result, unmount } = renderHook(() => useHomeData(true, true, "k"));
    now += REORDER_BUDGET_MS + 1;
    await act(async () => { d.resolve(DATA); await d.p; });
    expect(result.current.data).toBe(DATA);
    expect(result.current.order).toBeNull();
    unmount();
    vi.mocked(fetchHome).mockReturnValue(new Promise(() => {}));
    const next = renderHook(() => useHomeData(true, true, "k"));
    expect(next.result.current.order).toEqual(ORDER);
  });

  it("an order that lands after her first tap is not applied", async () => {
    const d = deferred();
    vi.mocked(fetchHome).mockReturnValue(d.p);
    const { result } = renderHook(() => useHomeData(true, true, "k"));
    window.dispatchEvent(new Event("pointerdown"));
    await act(async () => { d.resolve(DATA); await d.p; });
    expect(result.current.order).toBeNull();
  });

  it("switches that arrive after the first render still start from the remembered order", async () => {
    const d = deferred();
    vi.mocked(fetchHome).mockReturnValue(d.p);
    const first = renderHook(() => useHomeData(true, true, "k"));
    now += REORDER_BUDGET_MS + 1;
    await act(async () => { d.resolve(DATA); await d.p; });
    first.unmount();
    vi.mocked(fetchHome).mockReturnValue(new Promise(() => {}));
    // Home mounts with both switches off (useHomeSwitches starts OFF) and gets them when /config answers.
    const next = renderHook(({ on, orderOn }) => useHomeData(on, orderOn, "k"), { initialProps: { on: false, orderOn: false } });
    expect(next.result.current.order).toBeNull();
    next.rerender({ on: true, orderOn: true });
    expect(next.result.current.order).toEqual(ORDER);
  });

  it("a late order outlives the page: the next cold open (memory gone) starts from it", async () => {
    const d = deferred();
    vi.mocked(fetchHome).mockReturnValue(d.p);
    const first = renderHook(() => useHomeData(true, true, "k"));
    now += REORDER_BUDGET_MS + 1;
    await act(async () => { d.resolve(DATA); await d.p; });
    first.unmount();
    resetHomeOrderMemory({ keepStored: true });
    vi.mocked(fetchHome).mockReturnValue(new Promise(() => {}));
    const next = renderHook(() => useHomeData(true, true, "k"));
    expect(next.result.current.order).toEqual(ORDER);
    const other = renderHook(() => useHomeData(true, true, "someone-else"));
    expect(other.result.current.order).toBeNull();
  });

  it("a blocked or junk store is no order, never a throw", () => {
    localStorage.setItem("teacher-home-order:v1:k", "{not json");
    vi.mocked(fetchHome).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useHomeData(true, true, "k"));
    expect(result.current.order).toBeNull();
    localStorage.setItem("teacher-home-order:v1:k", JSON.stringify(["lessons", "nope"]));
    const again = renderHook(() => useHomeData(true, true, "k"));
    expect(again.result.current.order).toBeNull();
  });

  it("the order switch off: never an order, the card data still comes", async () => {
    vi.mocked(fetchHome).mockResolvedValue(DATA);
    const { result } = renderHook(() => useHomeData(true, false, "k"));
    await waitFor(() => expect(result.current.data).toBe(DATA));
    expect(result.current.order).toBeNull();
  });
});

describe("useHomeSwitches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only a real true is on; the order switch counts only with the card's", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeOrder: true } } as never);
    const a = renderHook(() => useHomeSwitches());
    await waitFor(() => expect(a.result.current).toEqual({ card: true, order: true, look: false }));
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: "yes", teacherHomeOrder: true } } as never);
    const b = renderHook(() => useHomeSwitches());
    await act(async () => { await Promise.resolve(); });
    expect(b.result.current).toEqual({ card: false, order: false, look: false });
  });

  it("an unreadable config is off", async () => {
    vi.mocked(readConfigShared).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useHomeSwitches());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual({ card: false, order: false, look: false });
  });
});

describe("useHomeSwitches — the look (portal_teacher_home_look)", () => {
  beforeEach(() => { vi.clearAllMocks(); resetHomeLookMemory(); });

  it("is off until /config answers, then on only for a real true with the card on", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeLook: true } } as never);
    const { result } = renderHook(() => useHomeSwitches("k"));
    expect(result.current.look).toBe(false);
    await waitFor(() => expect(result.current).toEqual({ card: true, order: false, look: true }));
  });

  it("rides on the card: the look true with the card off is off", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: false, teacherHomeLook: true } } as never);
    const { result } = renderHook(() => useHomeSwitches("k"));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.look).toBe(false);
  });

  it("anything but a real true is off", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeLook: "true" } } as never);
    const { result } = renderHook(() => useHomeSwitches("k"));
    await waitFor(() => expect(result.current.card).toBe(true));
    expect(result.current.look).toBe(false);
  });

  it("a look answered on is remembered: the next open starts from it, before /config answers", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeLook: true } } as never);
    const a = renderHook(() => useHomeSwitches("k"));
    await waitFor(() => expect(a.result.current.look).toBe(true));
    a.unmount();
    expect(localStorage.getItem("teacher-home-look:v1:k")).toBe("1");
    vi.mocked(readConfigShared).mockReturnValue(new Promise(() => {}));
    const b = renderHook(() => useHomeSwitches("k"));
    expect(b.result.current).toEqual({ card: true, order: false, look: true });
    const other = renderHook(() => useHomeSwitches("someone-else"));
    expect(other.result.current.look).toBe(false);
  });

  it("/config's false wins over the memory and clears it", async () => {
    localStorage.setItem("teacher-home-look:v1:k", "1");
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeLook: false } } as never);
    const { result } = renderHook(() => useHomeSwitches("k"));
    expect(result.current.look).toBe(true);
    await waitFor(() => expect(result.current.look).toBe(false));
    expect(result.current.card).toBe(true);
    expect(localStorage.getItem("teacher-home-look:v1:k")).toBeNull();
  });

  it("an unreadable config after a remembered look is off, and forgets it", async () => {
    localStorage.setItem("teacher-home-look:v1:k", "1");
    vi.mocked(readConfigShared).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useHomeSwitches("k"));
    await waitFor(() => expect(result.current).toEqual({ card: false, order: false, look: false }));
    expect(localStorage.getItem("teacher-home-look:v1:k")).toBeNull();
  });

  it("a blocked store is no memory, never a throw", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.mocked(readConfigShared).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useHomeSwitches("k"));
    expect(result.current.look).toBe(false);
    get.mockRestore();
  });

  it("a user key that arrives after the first render still starts from the remembered look", async () => {
    localStorage.setItem("teacher-home-look:v1:k", "1");
    vi.mocked(readConfigShared).mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderHook(({ key }: { key?: string }) => useHomeSwitches(key), { initialProps: {} as { key?: string } });
    expect(result.current.look).toBe(false);
    rerender({ key: "k" });
    await waitFor(() => expect(result.current).toEqual({ card: true, order: false, look: true }));
  });

  it("no user key: no memory read or written", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeLook: true } } as never);
    const { result } = renderHook(() => useHomeSwitches());
    await waitFor(() => expect(result.current.look).toBe(true));
    expect(Object.keys(localStorage).filter((k) => k.startsWith("teacher-home-look:v1:"))).toEqual([]);
  });
});

describe("useHomeGo", () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(MemoryRouter, null, children);
  let assign: ReturnType<typeof vi.fn>;
  const realLocation = window.location;
  beforeEach(() => {
    vi.clearAllMocks();
    assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  });

  it("a quiz-home tap leaves only after the tap log is sent (the page load would cancel it)", async () => {
    let sent!: () => void;
    vi.mocked(tapHome).mockReturnValue(new Promise<void>((r) => { sent = r; }));
    const { result } = renderHook(() => useHomeGo(), { wrapper });
    act(() => result.current("class", "/quiz/teacher/abc"));
    expect(tapHome).toHaveBeenCalledWith("class");
    await act(async () => { await Promise.resolve(); });
    expect(assign).not.toHaveBeenCalled();
    await act(async () => { sent(); await Promise.resolve(); await Promise.resolve(); });
    expect(assign).toHaveBeenCalledWith("/quiz/teacher/abc");
  });

  it("a slow log never holds her: she leaves after TAP_WAIT_MS", async () => {
    vi.useFakeTimers();
    vi.mocked(tapHome).mockReturnValue(new Promise<void>(() => {}));
    const { result } = renderHook(() => useHomeGo(), { wrapper });
    act(() => result.current("lesson", "/quiz/teacher/abc"));
    expect(assign).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(TAP_WAIT_MS); });
    expect(assign).toHaveBeenCalledWith("/quiz/teacher/abc");
  });
});

describe("useHomeLook (the menu's read of the look)", () => {
  beforeEach(() => { vi.clearAllMocks(); resetHomeLookMemory(); });

  it("is the look switch, from the same /config read", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeLook: true } } as never);
    const { result } = renderHook(() => useHomeLook("k"));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(readConfigShared).toHaveBeenCalledTimes(1);
  });

  it("rides on the card, and starts from a remembered look before /config answers", async () => {
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: false, teacherHomeLook: true } } as never);
    const a = renderHook(() => useHomeLook("k"));
    await act(async () => { await Promise.resolve(); });
    expect(a.result.current).toBe(false);
    localStorage.setItem("teacher-home-look:v1:k", "1");
    vi.mocked(readConfigShared).mockReturnValue(new Promise(() => {}));
    expect(renderHook(() => useHomeLook("k")).result.current).toBe(true);
  });

  it("not enabled (a coach): no read, no memory, always off", async () => {
    localStorage.setItem("teacher-home-look:v1:k", "1");
    vi.mocked(readConfigShared).mockResolvedValue({ features: { teacherHomeCard: true, teacherHomeLook: true } } as never);
    const { result } = renderHook(() => useHomeLook("k", false));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(false);
    expect(readConfigShared).not.toHaveBeenCalled();
    expect(localStorage.getItem("teacher-home-look:v1:k")).toBe("1");
  });
});
