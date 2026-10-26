import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoTeacher, F, http, httpError, renderRm, rmWorld, serve, settle } from "./harness";

/**
 * bd-sex15q.17 — S10, the Friday circle (G3, B22, API R20/R21, COPY §S10): one single-line row per coach "coach ·
 * school · W" with a play button (the clip's length), the gloss only once a row opens (R6 through circleAllows), no mark,
 * no grade, no subject, no date, no code; one row open at a time, the audio muted here and never preloaded; the sector
 * moves with their date, attendees and check, "Set this sector step" posting {i_id, w_id, date}; checks due per coach.
 */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe.each(["en", "ur"] as const)("S10 RM circle (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("rows are 'coach · school · W' and nothing else (B22); the contract holds; no teacher", async () => {
    const { container } = await renderRm("/circle");
    const page = screen.getByTestId("rm-circle");
    expectContract(page, expect);
    expectNoTeacher(container, expect);
    const rows = screen.getAllByTestId("circle-row");
    expect(rows).toHaveLength(F.rm_circle.moments.length);
    rows.forEach((r, i) => {
      const m = F.rm_circle.moments[i];
      const line = (within(r).getByTestId("circle-line").textContent || "").replace(/[⁦-⁩]/g, "");
      const sep = lang === "ur" ? "، " : " · ";
      expect(line).toBe([m.coach_label, m.school.school_name, m.short_name[lang]].join(sep));
      expect(/Grade|جماعت|[0-9]{1,2} (Oct|Sep)|اکتوبر|T-\d/.test(r.textContent || "")).toBe(false);
      expect(within(r).queryByTestId("circle-gloss")).toBeNull();
    });
    expect(http.get.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith("/coachip/m/"))).toEqual([]);
  });

  it("opening a row fetches its moment, shows the gloss and an unpreloaded clip; opening another closes the first", async () => {
    await renderRm("/circle");
    const rows = () => screen.getAllByTestId("circle-row");
    await act(async () => { fireEvent.click(within(rows()[0]).getByTestId("circle-play")); });
    await settle();
    expect(within(rows()[0]).getByTestId("circle-gloss").textContent).toBe(F.moment_rm.gloss[lang]);
    const audio = within(rows()[0]).getByTestId("circle-audio") as HTMLAudioElement;
    expect(audio.getAttribute("preload")).toBe("none");
    expect(audio.getAttribute("src")).toBe(`/api/portal/coachip/m/${F.rm_circle.moments[0].moment_id}/clip`);
    await act(async () => { fireEvent.click(within(rows()[1]).getByTestId("circle-line").parentElement as HTMLElement); });
    await settle();
    expect(rows().filter((r) => r.getAttribute("data-open") === "1")).toHaveLength(1);
    expect(rows()[1].getAttribute("data-open")).toBe("1");
  });

  it("a clip that cannot be served says so in the RM's words (A4)", async () => {
    const m = clone(F.moment_rm); m.clip.status = "failed";
    serve(rmWorld({ [`/coachip/m/${F.rm_circle.moments[0].moment_id}`]: m }));
    await renderRm("/circle");
    await act(async () => { fireEvent.click(within(screen.getAllByTestId("circle-row")[0]).getByTestId("circle-play")); });
    await settle();
    expect(screen.getByTestId("circle-clip-failed").textContent).toBe(lang === "en" ? "The clip could not be made. Ask the coach to bring it on Friday." : "کلپ نہیں بن سکا۔ کوچ سے کہیں کہ جمعے کو ساتھ لائیں۔");
  });

  it("Set this sector step posts {i_id, w_id, date} only, w from the library id", async () => {
    await renderRm("/circle");
    const move = screen.getAllByTestId("sector-move")[0];
    fireEvent.click(within(move).getByTestId("sector-move-set"));
    await act(async () => { fireEvent.click(within(move).getByTestId("sector-move-save")); });
    await settle();
    const posts = http.post.mock.calls.filter((c: unknown[]) => c[0] === "/coachip/rm/steps");
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toEqual({ i_id: "I-IP-TIME-3", w_id: "W-IP-TIME", date: "2026-10-29" });
    expect(screen.getByTestId("sector-move-done")).toBeTruthy();
  });

  it("empty: no moments this week, no sector moves", async () => {
    const c = clone(F.rm_circle); c.moments = []; c.sector_interventions = [];
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    expect(screen.getByTestId("s10-moments-empty").textContent).toBe(lang === "en" ? "No graded recordings in the sector this week" : "اس ہفتے سیکٹر میں کوئی جانچی گئی ریکارڈنگ نہیں");
    expect(screen.getByTestId("s10-sector-moves").textContent).toContain(lang === "en" ? "Pick the agenda" : "ایجنڈا چنیں");
  });

  it("a failed load is the failed state, never pending", async () => {
    serve(rmWorld({ "/coachip/rm/circle": () => { throw httpError(500); } }));
    await renderRm("/circle");
    expect(screen.getByTestId("rm-state").getAttribute("data-state")).toBe("failed");
  });
});
