import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, F, http, renderRm, rmWorld, serve, settle } from "./harness";

/**
 * fix-r5 s2 item 10, client half (qa-rm R3a FAIL 20261027T072543, idea 072625): two coaches can bring the SAME moment.
 * The rows key and open by coach_user_id, so one tap opens exactly one row (no duplicate-key warning, one GET /m/:id);
 * and the first tap on Play opens the row AND starts play inside the tap (the <audio> stays preload="none").
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("S10 circle rows by coach", () => {
  let play: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot("en");
    play = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

  it("two rows with the same moment_id: one tap opens exactly one row, one moment GET, no duplicate-key warning", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const c = clone(F.rm_circle);
    c.moments[1].moment_id = c.moments[0].moment_id; // the same lesson for C-01 and C-02
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    const rows = () => screen.getAllByTestId("circle-row");
    await act(async () => { fireEvent.click(within(rows()[0]).getByTestId("circle-line").parentElement as HTMLElement); });
    await settle();
    expect(rows().filter((r) => r.getAttribute("data-open") === "1")).toHaveLength(1);
    expect(screen.getAllByTestId("circle-open")).toHaveLength(1);
    expect(http.get.mock.calls.filter((x: unknown[]) => String(x[0]).startsWith("/coachip/m/"))).toHaveLength(1);
    const dupKey = err.mock.calls.some((args) => args.map(String).join(" ").includes("same key"));
    expect(dupKey).toBe(false);
  });

  it("the first tap on Play opens the row and calls play() in the same gesture; the audio stays preload none", async () => {
    serve(rmWorld());
    await renderRm("/circle");
    const row = screen.getAllByTestId("circle-row")[0];
    act(() => { fireEvent.click(within(row).getByTestId("circle-play")); });
    expect(play).toHaveBeenCalledTimes(1);
    await settle();
    expect(screen.getAllByTestId("circle-row")[0].getAttribute("data-open")).toBe("1");
    const audios = Array.from(document.querySelectorAll("audio"));
    expect(audios.length).toBeGreaterThan(0);
    audios.forEach((a) => expect(a.getAttribute("preload")).toBe("none"));
  });
});
