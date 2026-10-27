import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoTeacher, F, http, httpError, renderRm, rmWorld, serve, settle } from "./harness";
import { COPY } from "../../coach/insights/copy";
import { RM_COPY } from "../rm.copy";

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
      // fix-r5 item 5f: the C-NN label is an LTR atom, isolated in Urdu like the school name (CodeText)
      const label = within(r).getByTestId("circle-line").querySelector("[data-code]") as HTMLElement;
      expect(label.textContent).toBe(lang === "ur" ? `\u2066${m.coach_label}\u2069` : m.coach_label);
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
    expect(screen.getByTestId("circle-clip-failed").textContent).toBe(COPY["e.503_clip.rm"][lang]);
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

  /* fix-r5 item 1-UI (SPEC v2.1 §11.1, API R20 basis/floor, COPY v1.1 §S10) */
  const strip = (s: string | null) => (s || "").replace(/[\u2066-\u2069]/g, "");
  const basisText = (c: number) => RM_COPY["s10.moments.basis.coach"][lang].replace("{c}", lang === "ur" ? String(c).replace(/[0-9]/g, (x) => "۰۱۲۳۴۵۶۷۸۹"[Number(x)]) : String(c));

  it("basis coach: the floor line sits above the rows, {c} a Count node (data-num=c, data-den=3, the sector's 4-week window); contract holds", async () => {
    const c = clone(F.rm_circle); c.basis = "coach";
    const sectorWin = { ...c.window, id: "lp-4w-2026-09-28", from: "2026-09-28", to: "2026-10-25", weeks: 4 };
    c.windows = [...c.windows, sectorWin];
    c.floor = { coaches_with_5plus: 2, needed: 3, window_id: sectorWin.id };
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    const line = screen.getByTestId("s10-basis");
    expect(strip((line.querySelector("p[data-nonum]") as HTMLElement).textContent)).toBe(basisText(2));
    expect(line.querySelector(`[data-window="${sectorWin.id}"]`)).toBeTruthy();
    const num = line.querySelector("[data-num]") as HTMLElement;
    expect({ num: num.getAttribute("data-num"), den: num.getAttribute("data-den"), win: num.getAttribute("data-win") }).toEqual({ num: "2", den: "3", win: sectorWin.id });
    // above the rows
    const card = screen.getByTestId("s10-moments");
    const first = within(card).getAllByTestId("circle-row")[0];
    expect(line.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectContract(screen.getByTestId("rm-circle"), expect);
  });

  it("basis sector (and the fixture's default): no floor line", async () => {
    expect(F.rm_circle.basis).toBe("sector");
    expect(F.rm_circle.floor).toBeNull();
    await renderRm("/circle");
    expect(screen.queryByTestId("s10-basis")).toBeNull();
    expect(screen.getAllByTestId("circle-row")).toHaveLength(F.rm_circle.moments.length);
  });

  it("basis coach with no moment: empty.floor, never a zero, no floor line", async () => {
    const c = clone(F.rm_circle); c.moments = []; c.basis = "coach"; c.floor = { coaches_with_5plus: 0, needed: 3, window_id: c.window.id };
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    expect(screen.getByTestId("s10-moments-empty").textContent).toBe(RM_COPY["s10.moments.empty.floor"][lang]);
    expect(screen.queryByTestId("s10-basis")).toBeNull();
    expect(screen.getByTestId("s10-moments").querySelector('[data-num="0"]')).toBeNull();
    expectContract(screen.getByTestId("rm-circle"), expect);
  });

  // red-2 20261027T001002: coaches do rank but none had a moment in the window (or the circle stage has not run): the
  // floor sentence would be false, so the neutral line, still never a zero
  it("basis coach, no moment, coaches ranked: the neutral empty line, not the floor sentence", async () => {
    const c = clone(F.rm_circle); c.moments = []; c.basis = "coach"; c.floor = { coaches_with_5plus: 3, needed: 3, coaches_ranked: 2, window_id: c.window.id };
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    expect(screen.getByTestId("s10-moments-empty").textContent).toBe(RM_COPY["s10.moments.empty.coach"][lang]);
    expect(screen.getByTestId("s10-moments").querySelector('[data-num]')).toBeNull();
    expectContract(screen.getByTestId("rm-circle"), expect);
  });

  it("basis coach, no moment, coaches_ranked 0: the floor sentence", async () => {
    const c = clone(F.rm_circle); c.moments = []; c.basis = "coach"; c.floor = { coaches_with_5plus: 1, needed: 3, coaches_ranked: 0, window_id: c.window.id };
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    expect(screen.getByTestId("s10-moments-empty").textContent).toBe(RM_COPY["s10.moments.empty.floor"][lang]);
  });

  it("floor present but no coach ranked (basis still sector): empty.floor too", async () => {
    const c = clone(F.rm_circle); c.moments = []; c.basis = "sector"; c.floor = { coaches_with_5plus: 1, needed: 3, window_id: c.window.id };
    serve(rmWorld({ "/coachip/rm/circle": c }));
    await renderRm("/circle");
    expect(screen.getByTestId("s10-moments-empty").textContent).toBe(RM_COPY["s10.moments.empty.floor"][lang]);
  });

  it("a failed load is the failed state, never pending", async () => {
    serve(rmWorld({ "/coachip/rm/circle": () => { throw httpError(500); } }));
    await renderRm("/circle");
    expect(screen.getByTestId("rm-state").getAttribute("data-state")).toBe("failed");
  });
});
