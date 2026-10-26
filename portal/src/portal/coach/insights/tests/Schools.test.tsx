import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoIdentity, F, http, httpError, renderAt, serve } from "./harness";
import { domContract } from "../count";
import { COPY } from "../copy";

/**
 * bd-sex15q.15 — the Schools tab goldens: every school in scope in the API's order (oldest visit first, never by a
 * count), its last visit and graded line, and its top W as the one WRow (or "nothing to do here"), EN and UR.
 */
const LANGS = ["en", "ur"] as const;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe.each(LANGS)("Schools tab (%s)", (lang) => {
  afterEach(() => cleanup());
  beforeEach(async () => {
    http.get.mockReset();
    await boot(lang);
  });

  it("normal: API order, a WRow per top W, a school with none, contract, no identity", async () => {
    serve({ "/coachip/schools": F.schools });
    const { container } = await renderAt("/schools");
    expect(screen.getByTestId("insights-schools")).toBeTruthy();
    const rows = screen.getAllByTestId("schools-row");
    const want = (F.schools.schools as { school: { school_id: string } }[]).map((s) => s.school.school_id);
    expect(rows.map((r) => r.getAttribute("data-school"))).toEqual(want);
    expect(screen.getAllByTestId("wrow")).toHaveLength(5);
    expect(screen.getAllByTestId("wrow")[0].getAttribute("href")).toBe("/portal/coach/insights/w/W-IP-TIME");
    const none = rows[rows.length - 1];
    expect(within(none).getByTestId("schools-top-none").textContent).toBe(COPY["schools.top_w.none"][lang]);
    expectContract(container, expect);
    expectNoIdentity(container, expect);
    expect(container.innerHTML).toMatchSnapshot();
  }, 30000);

  it("a school never visited says so", async () => {
    const d = clone(F.schools);
    d.schools[0].last_visit = null;
    serve({ "/coachip/schools": d });
    const { container } = await renderAt("/schools");
    expect(screen.getAllByTestId("schools-row")[0].textContent).toContain(COPY["schools.row.never"][lang]);
    expectContract(container, expect);
  }, 30000);

  it("a load failure shows the error block", async () => {
    serve({ "/coachip/schools": () => { throw httpError(500, { error: "server_error" }); } });
    const { container } = await renderAt("/schools");
    expect(screen.getByTestId("insights-state").getAttribute("data-state")).toBe("failed");
    expect(domContract(container).bareDigits).toEqual([]);
  }, 30000);

  it("switch off: sent elsewhere, nothing read", async () => {
    await boot(lang, { coachV2: true, coachip: false });
    serve({ "/coachip/schools": F.schools });
    await renderAt("/schools");
    expect(screen.getByTestId("elsewhere")).toBeTruthy();
    expect(http.get.mock.calls.some((c) => c[0] === "/coachip/schools")).toBe(false);
  }, 30000);
});
