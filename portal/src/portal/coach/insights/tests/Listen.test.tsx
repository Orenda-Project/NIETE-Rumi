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
 * bd-sex15q.15 — the Listen tab goldens (G2): the base line, W filter chips with their counts (a chip re-reads
 * `GET /coachip/moments?w=`), rows newest first as sent, a clip-failed row, analysis-failed rows (no code), one inline
 * player at a time, and both empty states, EN and UR.
 */
const LANGS = ["en", "ur"] as const;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
type M = { w: { w_id: string }; kind: string };

function feed(w?: unknown) {
  const d = clone(F.moments);
  if (!w) return d;
  d.moments = (d.moments as M[]).filter((m) => (w === "good" ? m.kind === "good" : m.w.w_id === w && m.kind !== "good"));
  d.failed_sessions = [];
  return d;
}

describe.each(LANGS)("Listen (%s)", (lang) => {
  afterEach(() => cleanup());
  beforeEach(async () => {
    http.get.mockReset();
    await boot(lang);
  });

  it("normal: base line, chips, rows in sent order, clip-failed and analysis-failed rows", async () => {
    serve({ "/coachip/moments": (p?: Record<string, unknown>) => feed(p?.w) });
    const { container } = await renderAt("/listen");
    expect(screen.getByTestId("insights-listen")).toBeTruthy();
    expect(screen.getByTestId("listen-base").querySelector('[data-num="5"][data-den="14"]')).toBeTruthy();
    const chips = screen.getAllByTestId("listen-chip");
    expect(chips.map((c) => c.getAttribute("data-w"))).toEqual(["", "W-IP-TIME", "W-EXIT-NOPLAN", "good"]);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(chips[3].textContent).toContain(COPY["l.filter.good"][lang]);
    for (const c of chips) expect(c.querySelector("[data-num]")).toBeTruthy();
    const rows = screen.getAllByTestId("listen-row");
    const want = (F.moments.moments as { moment_id: string }[]).map((m) => m.moment_id);
    expect(rows.map((r) => r.getAttribute("data-moment"))).toEqual(want);
    expect(within(rows[0]).getByTestId("listen-open").getAttribute("href")).toBe(`/portal/coach/insights/m/${want[0]}`);
    // the good example uses its own line
    expect(rows[2].textContent).toContain(lang === "en" ? "What good sounds like" : "اچھا کیسا سنائی دیتا ہے");
    // clip failed: the full recording from lesson_s (1250 s = 20:50)
    const failed = rows[1];
    expect(within(failed).getByTestId("listen-row-failed").textContent).toContain("20:50");
    // analysis failed: date + school, never a code
    const af = screen.getAllByTestId("listen-failed-session");
    expect(af).toHaveLength(2);
    for (const r of af) {
      expect(r.textContent).not.toMatch(/T-\d+/);
      expect(r.querySelector("audio")!.getAttribute("src")).toMatch(/^\/api\/portal\/coachip\/session\/[0-9a-f-]+\/audio$/);
    }
    expectContract(container, expect);
    expectNoIdentity(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("a tap on the time plays inline, one at a time", async () => {
    serve({ "/coachip/moments": (p?: Record<string, unknown>) => feed(p?.w) });
    const { container } = await renderAt("/listen");
    const plays = screen.getAllByTestId("listen-play");
    expect(screen.queryAllByTestId("moment-slot")).toHaveLength(0);
    fireEvent.click(plays[0]);
    await settle(2);
    expect(screen.getAllByTestId("moment-slot")).toHaveLength(1);
    expect(within(screen.getAllByTestId("listen-row")[0]).getByTestId("moment-slot")).toBeTruthy();
    fireEvent.click(plays[2]);
    await settle(2);
    expect(screen.getAllByTestId("moment-slot")).toHaveLength(1);
    expect(within(screen.getAllByTestId("listen-row")[2]).getByTestId("moment-slot")).toBeTruthy();
    expectContract(container, expect);
  }, 30000);

  it("a filter chip re-reads the feed with ?w= and shows only that W", async () => {
    serve({ "/coachip/moments": (p?: Record<string, unknown>) => feed(p?.w) });
    const { container } = await renderAt("/listen");
    fireEvent.click(screen.getAllByTestId("listen-chip")[1]);
    await settle();
    const calls = http.get.mock.calls.filter((c) => c[0] === "/coachip/moments");
    expect(calls).toHaveLength(2);
    expect(calls[0][1]?.params ?? {}).toEqual({});
    expect(calls[1][1].params).toEqual({ w: "W-IP-TIME" });
    expect(screen.getAllByTestId("listen-chip")[1].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByTestId("listen-row")).toHaveLength(3);
    expect(screen.queryAllByTestId("listen-failed-session")).toHaveLength(0);
    expectContract(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("empty filter: no moment of that W this week", async () => {
    serve({ "/coachip/moments": (p?: Record<string, unknown>) => (p?.w ? { ...feed(p.w), moments: [] } : feed()) });
    const { container } = await renderAt("/listen");
    fireEvent.click(screen.getAllByTestId("listen-chip")[2]);
    await settle();
    const e = screen.getByTestId("listen-empty-filter");
    expect(e.textContent).toContain(F.moments.filters[1].short_name[lang]);
    expect(screen.queryAllByTestId("listen-row")).toHaveLength(0);
    expectContract(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("empty week: no graded recordings yet", async () => {
    const d = clone(F.moments);
    d.recordings = { n: 0, d: 4, window_id: d.window.id };
    d.base = { n: 0, d: 0, window_id: d.window.id };
    d.moments = [];
    d.failed_sessions = [];
    d.filters = (d.filters as { count: unknown }[]).map((f) => ({ ...f, count: { n: 0, d: 0, window_id: d.window.id } }));
    serve({ "/coachip/moments": d });
    const { container } = await renderAt("/listen");
    const e = screen.getByTestId("listen-empty-all").closest("[data-num]")!;
    expect(e.getAttribute("data-num")).toBe("0");
    expect(e.getAttribute("data-den")).toBe("4");
    expectContract(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("a load failure shows the error block", async () => {
    serve({ "/coachip/moments": () => { throw httpError(500, { error: "server_error" }); } });
    const { container } = await renderAt("/listen");
    expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("failed");
    expect(domContract(container).bareDigits).toEqual([]);
  }, 30000);

  it("switch off: sent elsewhere, nothing read", async () => {
    await boot(lang, { coachV2: true, coachip: false });
    serve({ "/coachip/moments": feed() });
    await renderAt("/listen");
    expect(screen.getByTestId("elsewhere")).toBeTruthy();
    expect(http.get.mock.calls.some((c) => c[0] === "/coachip/moments")).toBe(false);
  }, 30000);
});
