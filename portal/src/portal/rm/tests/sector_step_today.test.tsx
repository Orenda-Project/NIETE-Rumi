import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, F, http, renderRm, rmWorld, serve, settle } from "./harness";
import { RM_COPY } from "../rm.copy";
import { dateLong } from "../../coach/insights/format";

/**
 * fix-r5 s2 item 11, client (qa-rm R3b FAIL 20261027T072544; wA 4aac292734: the server stays today-only, because
 * check_by_rule '14_days' stores check_by = set_at::date + 14 and no planned date). The default UI action on S10's
 * "Set this sector step" must post today's Karachi date (it posted the library date / the next Friday, so 400), and the
 * confirmation says it is set today with its check date (today + 14).
 */
const TODAY = "2026-10-26"; // 05:00Z = 10:00 in Karachi
const CHECK = "2026-11-09";

describe.each(["en", "ur"] as const)("S10 sector step is set today (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld({ "POST /coachip/rm/steps": (_p: string, body: { date: string }) => ({ ...F.rm_steps_post_201, step: { ...F.rm_steps_post_201.step, date: body.date } }) }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("the default action posts date === today, and the confirmation names today and the check date", async () => {
    await renderRm("/circle");
    const move = screen.getAllByTestId("sector-move")[0];
    await act(async () => { fireEvent.click(within(move).getByTestId("sector-move-set")); });
    await settle();
    // the old UI needed a second tap on its date row's Save: take the default path whatever it is
    const save = within(move).queryByTestId("sector-move-save");
    if (save) { await act(async () => { fireEvent.click(save); }); await settle(); }
    const posts = http.post.mock.calls.filter((c: unknown[]) => c[0] === "/coachip/rm/steps");
    expect(posts).toHaveLength(1);
    expect((posts[0][1] as { date: string }).date).toBe(TODAY);
    expect(within(move).queryByTestId("sector-move-date")).toBeNull();
    const done = within(move).getByTestId("sector-move-done");
    const want = RM_COPY["s10.sector_moves.done.today"][lang].replace("{date}", dateLong(TODAY, lang)).replace("{date2}", dateLong(CHECK, lang));
    expect((done.textContent || "").replace(/[⁦-⁩]/g, "")).toBe(want);
  });

  it("the button says it is set today", async () => {
    await renderRm("/circle");
    expect(within(screen.getAllByTestId("sector-move")[0]).getByTestId("sector-move-set").textContent).toBe(RM_COPY["s10.sector_moves.set.today"][lang]);
  });
});
