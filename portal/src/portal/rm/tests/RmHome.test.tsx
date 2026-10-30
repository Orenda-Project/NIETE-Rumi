import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoTeacher, F, httpError, renderRm, rmWorld, serve } from "./harness";
import { dateLong, todayKarachi } from "../../coach/insights/format";

/**
 * bd-sex15q.17 — S8, the Monday sector card (DESIGN §3 S8, API R17, COPY §S8, G4, G8, G9, G10, B5, B9, B22, B23), in
 * both languages, from c-api's fixture: the opening sentence's counts, the month's two W by school with no coach (G4),
 * the B23 not-yet row, "which coach needs me" as two groups in the server's order (no position, no sort control, three
 * activity lines and one Follow-up per row), the Monday bar, the circle and cluster cards, the trust line, and the
 * no-sector, stale and empty states. Every number carries the DOM contract; no teacher appears.
 */
type Lang = "en" | "ur";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe.each(["en", "ur"] as Lang[])("S8 RM home (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("renders the card with every number under the DOM contract and no teacher", async () => {
    const { container } = await renderRm("");
    const page = screen.getByTestId("rm-home");
    const c = expectContract(page, expect);
    expect(c.nums).toBeGreaterThanOrEqual(30);
    expectNoTeacher(container, expect);
    if (lang === "ur") {
      expect(/[٠-٩]/.test(page.textContent || "")).toBe(false);
      expect(/[۰-۹] ?·|· ?[۰-۹]/.test(page.textContent || "")).toBe(false);
    }
    expect((page.textContent || "").replace(/[\u2066-\u2069]/g, "")).toContain(lang === "en" ? "Urban-I · Monday" : "Urban-I، پیر");
  });

  it("fix-r5 5g: s8.sub is the date only, no count (COPY v1.1 §8)", async () => {
    await renderRm("");
    const sub = screen.getByTestId("rm-page-sub");
    expect(sub.textContent).toBe(dateLong(todayKarachi(), lang));
    expect(sub.querySelector("[data-num]")).toBeNull();
    expect((sub.querySelector("[data-date]") as HTMLElement).textContent).toBe(sub.textContent);
  });

  it("fix-r5: s8.circle.sub says its base, {m} of {c} coaches have a moment (A6), then the checks", async () => {
    await renderRm("");
    const card = screen.getByTestId("rm-circle-card");
    const nums = Array.from(card.querySelectorAll("[data-num]")).map((e) => `${e.getAttribute("data-num")}/${e.getAttribute("data-den")}`);
    expect(nums).toEqual([`${F.rm_home.circle.moments.n}/${F.rm_home.circle.moments.d}`, `${F.rm_home.circle.checks_due.n}/${F.rm_home.circle.checks_due.d}`]);
    expect(card.textContent).toContain(lang === "en" ? "coaches have a moment" : "کوچوں کے لمحے");
  });

  it("the opening sentence carries its three counts with the sector's bases, then the floor, unassigned and no-school rows", async () => {
    await renderRm("");
    const s = screen.getByTestId("rm-opening-sentence");
    const nums = Array.from(s.querySelectorAll("[data-num]")).map((e) => `${e.getAttribute("data-num")}/${e.getAttribute("data-den")}`);
    expect(nums).toEqual(["41/62", "21/62", "38/214"]);
    const card = screen.getByTestId("rm-opening");
    // bd-sex15q.47 (ux-lead-2 183234 #3): the unassigned and no-school lines moved out of the band to rm-coverage
    const all = Array.from(card.querySelectorAll("[data-num]")).map((e) => `${e.getAttribute("data-num")}/${e.getAttribute("data-den")}`);
    expect(all).toEqual(["41/62", "21/62", "38/214"]);
    const cov = Array.from(screen.getByTestId("rm-coverage").querySelectorAll("[data-num]")).map((e) => `${e.getAttribute("data-num")}/${e.getAttribute("data-den")}`);
    expect(cov).toEqual(["2/62", "1/10"]);
    expect(card.textContent).toContain(lang === "en" ? "Floor: every school every 4 weeks" : "کم از کم: ہر اسکول ہر ۴ ہفتوں میں");
  });

  it("G4: the month's rows list three schools each, never a coach; the B23 row reads the coach count, not a share", async () => {
    await renderRm("");
    const rows = screen.getAllByTestId("sector-wrow");
    expect(rows.map((r) => r.getAttribute("data-w"))).toEqual(["W-IP-TIME", "W-WARM"]);
    expect(rows[0].getAttribute("data-agenda")).toBe("1");
    const bySchool = within(rows[0]).getAllByTestId("by-school-row");
    expect(bySchool).toHaveLength(3);
    for (const b of bySchool) expect(/C-\d{2}/.test(b.textContent || "")).toBe(false);
    expect(within(rows[0]).getAllByTestId("by-school-row").map((b) => b.querySelector("[data-num]")?.getAttribute("data-num"))).toEqual(["7", "6", "6"]);
    expect(rows[1].getAttribute("data-state")).toBe("not_yet");
    expect(rows[1].querySelector('[data-num="2"][data-den="3"]')).not.toBeNull();
    expect(rows[1].textContent).toContain(lang === "en" ? "Not enough recordings yet across the sector" : "سیکٹر بھر میں ابھی کافی ریکارڈنگز نہیں");
    expect(/Move 2|دوسرا قدم/.test(screen.getByTestId("rm-moves").textContent || "")).toBe(false);
  });

  it("B9: two groups in the server's order, no position number, no sort control; three activity counts and one Follow-up per row", async () => {
    await renderRm("");
    const needs = screen.getByTestId("group-needs_me");
    const on = screen.getByTestId("group-on_track");
    const labels = (g: HTMLElement) => within(g).getAllByTestId("coach-label").map((e) => e.textContent);
    expect(labels(needs)).toEqual(F.rm_home.groups.needs_me.map((c: { coach_label: string }) => c.coach_label));
    expect(labels(on)).toEqual(F.rm_home.groups.on_track.map((c: { coach_label: string }) => c.coach_label));
    for (const row of within(screen.getByTestId("coach-groups")).getAllByTestId("coach-row")) {
      // fix-r5 s2 item 3 (B10): a count with base 0 is a words line (data-none), never a "0 of 0" number node
      expect(row.querySelectorAll("[data-num], [data-none]")).toHaveLength(3);
      expect(row.querySelector('[data-num][data-den="0"]')).toBeNull();
      expect(within(row).getAllByTestId("follow-up")).toHaveLength(1);
      expect(row.querySelector("ol, [aria-sort], select")).toBeNull();
    }
    expect(screen.getByTestId("coach-groups").querySelector("select, [aria-sort], [data-sort]")).toBeNull();
    expect(on.querySelector('[data-num="5"][data-den="9"]')).not.toBeNull();
    // C-03 carries an open note: its status shows, never its lines
    expect(within(needs).getAllByTestId("note-open")).toHaveLength(1);
  });

  it("each coach row opens S9 by the coach's id (a coach is staff), never a teacher", async () => {
    await renderRm("");
    const a = screen.getAllByTestId("coach-row")[0].querySelector("a") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("/portal/rm/coach/00000000-0000-4000-8000-070000000003");
  });

  it("the circle, cluster and Monday cards, and the trust line", async () => {
    await renderRm("");
    const circle = screen.getByTestId("rm-circle-card");
    expect(circle.getAttribute("href")).toBe("/portal/rm/circle");
    expect(Array.from(circle.querySelectorAll("[data-num]")).map((e) => `${e.getAttribute("data-num")}/${e.getAttribute("data-den")}`)).toEqual(["6/9", "7/23"]);
    expect(screen.getByTestId("rm-cluster").textContent).toContain(lang === "en" ? "Peer observation with one look-for" : "ساتھی مشاہدہ");
    expect(screen.getByTestId("rm-monday").textContent).toContain(lang === "en" ? "Send each coach a three-line follow-up" : "ہر کوچ کو تین سطروں کی یاد دہانی بھیجیں");
    expect(screen.getByTestId("rm-trust").textContent).toContain(lang === "en" ? "No teacher appears on this page." : "اس صفحے پر کوئی استاد نہیں۔");
  });

  it("no sector (R17 404): only 'No sector is assigned to you yet.'", async () => {
    serve(rmWorld({ "/coachip/rm/home": () => { throw httpError(404); } }));
    await renderRm("");
    expect(screen.getByTestId("rm-no-sector").textContent).toBe(lang === "en" ? "No sector is assigned to you yet." : "ابھی آپ کو کوئی سیکٹر تفویض نہیں ہوا۔");
    expect(screen.queryByTestId("coach-groups")).toBeNull();
  });

  it("stale: last night's run failed, yesterday's sector shows with its date; a failed load never reads as pending (B10)", async () => {
    const h = clone(F.rm_home);
    h.stale = { as_of: "2026-10-25", reason: "failed" };
    serve(rmWorld({ "/coachip/rm/home": h }));
    await renderRm("");
    expect(screen.getByTestId("rm-stale").textContent).toContain(lang === "en" ? "Last night's analysis did not run." : "گزشتہ رات کا تجزیہ نہیں چلا۔");
    expect(screen.getByTestId("coach-groups")).toBeTruthy();
    cleanup();
    serve(rmWorld({ "/coachip/rm/home": () => { throw httpError(500); } }));
    await renderRm("");
    expect(screen.getByTestId("rm-state").getAttribute("data-state")).toBe("failed");
  });

  it("empty: the server's message shows and the coach groups stay", async () => {
    const h = clone(F.rm_home);
    h.empty = { status: "insufficient", message: { en: "Not enough recordings yet across the sector.", ur: "سیکٹر بھر میں ابھی کافی ریکارڈنگز نہیں۔" }, detail: { graded: null, widened_to_weeks: null, as_of: null } };
    h.moves = [];
    serve(rmWorld({ "/coachip/rm/home": h }));
    await renderRm("");
    expect(screen.getByTestId("rm-empty").textContent).toContain(lang === "en" ? "Not enough recordings yet" : "ابھی کافی ریکارڈنگز نہیں");
    expect(screen.queryByTestId("rm-moves")).toBeNull();
    expect(screen.getByTestId("coach-groups")).toBeTruthy();
  });
});
