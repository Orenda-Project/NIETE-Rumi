import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoTeacher, F, httpError, renderRm, rmWorld, serve } from "./harness";

/**
 * bd-sex15q.17 — S9, one coach for the RM (SPEC v2 §3 "S9", API R18, COPY §S9): label and group reason, schools with
 * weeks since the last visit against the floor of 4 (late ones marked, never red), three step counts, the two moves with
 * the sector's count beside them, the notes with their status, Send follow-up, the calibration placeholder, the trust
 * line. No teacher, no per-teacher number. Another sector's coach (or a made-up id) is "not available".
 */
const C03 = "00000000-0000-4000-8000-070000000003";

describe.each(["en", "ur"] as const)("S9 RM coach (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("renders every block under the DOM contract, no teacher", async () => {
    const { container } = await renderRm(`/coach/${C03}`);
    const page = screen.getByTestId("rm-coach");
    expectContract(page, expect);
    expectNoTeacher(container, expect);
    expect(page.textContent).toContain(lang === "en" ? "Schools waiting for a visit" : "دوروں کے منتظر اسکول");
    const schools = screen.getAllByTestId("s9-school");
    expect(schools).toHaveLength(6);
    expect(schools.filter((s) => s.getAttribute("data-late") === "1")).toHaveLength(1);
    expect(schools[5].textContent).toContain(lang === "en" ? "no visit booked" : "کوئی دورہ طے نہیں");
    expect(Array.from(screen.getByTestId("s9-steps").querySelectorAll("[data-num]")).map((e) => e.getAttribute("data-num"))).toEqual(["3", "1", "1"]);
    const rows = screen.getAllByTestId("s9-wrow");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(within(r).getByTestId("sector-line")).toBeTruthy();
    expect(screen.getAllByTestId("s9-note").map((n) => n.getAttribute("data-status"))).toEqual(F.rm_coach.notes.map((n: { status: string }) => n.status));
    expect(screen.getByTestId("s9-calibration").textContent).toContain(lang === "en" ? "Shared lesson" : "مشترکہ سبق");
    expect(screen.getByTestId("rm-trust").textContent).toContain(lang === "en" ? "No teacher appears here." : "یہاں کوئی استاد نہیں۔");
    expect(screen.getByTestId("s9-follow-up")).toBeTruthy();
  });

  it("another sector's coach or a made-up id: not available, nothing else", async () => {
    serve(rmWorld({ [`/coachip/rm/coach/${C03}`]: () => { throw httpError(404); } }));
    await renderRm(`/coach/${C03}`);
    expect(screen.getByTestId("rm-coach-404")).toBeTruthy();
    expect(screen.queryByTestId("s9-schools")).toBeNull();
  });
});
