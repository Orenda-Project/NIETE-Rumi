import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoIdentity, F, http, httpError, renderAt, serve, settle } from "./harness";
import { domContract } from "../count";
import { COPY } from "../copy";

/**
 * bd-sex15q.15 — S3 goldens (G5): schools in the payload's order, codes with their recordings, the suppression rows
 * (too few, not showing), and the Trend disclosure (indigo dots, never red, never a percentage), EN and UR.
 */
const W = "W-IP-TIME";
const LANGS = ["en", "ur"] as const;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe.each(LANGS)("S3 Where (%s)", (lang) => {
  afterEach(() => cleanup());
  beforeEach(async () => {
    http.get.mockReset();
    await boot(lang);
  });

  it("normal: payload order, a too_few school, not-showing line, contract, no identity", async () => {
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`] });
    const { container } = await renderAt(`/w/${W}/where`);
    expect(screen.getByTestId("insights-where")).toBeTruthy();
    const rows = screen.getAllByTestId("school-row");
    const want = (F[`w_${W}`].schools as { school: { school_id: string } }[]).map((s) => s.school.school_id);
    expect(rows.map((r) => r.getAttribute("data-school"))).toEqual(want);
    const tooFew = rows.find((r) => r.getAttribute("data-state") === "too_few")!;
    expect(within(tooFew).getByTestId("school-too-few")).toBeTruthy();
    expect(within(tooFew).queryAllByTestId("school-code")).toHaveLength(0);
    // a school with no visit booked says so
    const noVisit = rows[rows.length - 1];
    expect(noVisit.textContent).toContain(lang === "en" ? "no visit booked" : "کوئی دورہ طے نہیں");
    expect(screen.getByTestId("where-not-showing").querySelector('[data-num="1"][data-den="6"]')).toBeTruthy();
    // trend closed at rest
    expect(screen.queryAllByTestId("trend-dot")).toHaveLength(0);
    expect(container.textContent).not.toContain("%");
    expectContract(container, expect);
    expectNoIdentity(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("Trend opens to one dot per lesson: filled, half, outline; no red", async () => {
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`] });
    const { container } = await renderAt(`/w/${W}/where`);
    const toggles = screen.getAllByTestId("trend-toggle");
    // T-07, T-19, T-25, T-03, T-05, T-31 have a strip (graded n >= 4)
    expect(toggles).toHaveLength(6);
    expect(toggles[1].getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggles[1]); // T-19: false, false... with one partial
    await settle(2);
    expect(toggles[1].getAttribute("aria-expanded")).toBe("true");
    const dots = screen.getAllByTestId("trend-dot");
    expect(dots.map((d) => d.getAttribute("data-shows"))).toEqual(["true", "false", "false", "partial"]);
    expect(screen.getByTestId("trend-hint").textContent).toBe(COPY["s3.trend.hint"][lang]);
    for (const d of dots) expect(d.className).not.toMatch(/red|#(?:ef4444|dc2626|b91c1c|f87171)/i);
    expect(dots[0].className).toContain("#4f46e5");
    expectContract(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("no_graded school states its recordings and no codes", async () => {
    const d = clone(F[`w_${W}`]);
    d.schools[1].state = "no_graded";
    d.schools[1].codes = [];
    serve({ [`/coachip/w/${W}`]: d });
    const { container } = await renderAt(`/w/${W}/where`);
    expect(screen.getByTestId("school-no-graded")).toBeTruthy();
    expectContract(container, expect);
  }, 30000);

  it("a load failure shows the error block", async () => {
    serve({ [`/coachip/w/${W}`]: () => { throw httpError(404); } });
    const { container } = await renderAt(`/w/${W}/where`);
    expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("not_found");
    expect(domContract(container).bareDigits).toEqual([]);
  }, 30000);

  it("switch off: sent elsewhere, nothing read", async () => {
    await boot(lang, { coachV2: true, coachip: false });
    serve({ [`/coachip/w/${W}`]: F[`w_${W}`] });
    await renderAt(`/w/${W}/where`);
    expect(screen.getByTestId("elsewhere")).toBeTruthy();
    expect(http.get.mock.calls.some((c) => String(c[0]).startsWith("/coachip/w/"))).toBe(false);
  }, 30000);
});
