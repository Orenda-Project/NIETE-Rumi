import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, F } from "../../coach/insights/tests/harness";
import { renderRm, rmWorld } from "../../rm/tests/harness";
import { nOfD } from "../../coach/insights/format";

/**
 * bd-sex15q.42 (R6 ux-system) — the rows, red-first. G9's WRow is a hairline row (no boxed card) whose count is the
 * number pattern (a big n and a small "of d" in ONE count node whose text is still nOfD) with a fraction bar; the RM's
 * SectorWRow is built on WRow's frame (C2) and its ranked count is a ring, each school with its own bar.
 */
type Lang = "en" | "ur";

describe.each(["en", "ur"] as Lang[])("R6 rows (%s)", (lang) => {
  beforeEach(async () => { await boot(lang); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("S1's Move 2 WRow: a hairline row, the count as big n + 'of d' (text still nOfD), a fraction bar", async () => {
    serve({ "/coachip/home": F.home });
    await renderAt("");
    const row = screen.getAllByTestId("wrow")[0];
    expect(row.className).not.toContain("rounded-2xl");
    expect(row.className).toContain("border-cp-hairline");
    const num = row.querySelector("[data-num]") as HTMLElement;
    const n = Number(num.getAttribute("data-num"));
    const d = Number(num.getAttribute("data-den"));
    expect(num.textContent).toBe(nOfD(n, d, lang));
    expect(num.querySelector("b")).not.toBeNull();
    expect(row.querySelector(`[data-bar="${n}/${d}"]`)).not.toBeNull();
  });

  it("S8's SectorWRow is WRow's frame: the ranked count is a ring, every by-school row has its bar, the count text is nOfD", async () => {
    serve(rmWorld());
    await renderRm("");
    const rows = screen.getAllByTestId("sector-wrow");
    expect(rows[0].getAttribute("data-wrow")).toBe("sector");
    expect(rows[0].querySelector("[data-ring]")).not.toBeNull();
    const num = rows[0].querySelector(":scope [data-num]") as HTMLElement;
    expect(num.textContent).toBe(nOfD(Number(num.getAttribute("data-num")), Number(num.getAttribute("data-den")), lang));
    for (const b of within(rows[0]).getAllByTestId("by-school-row")) {
      const c = b.querySelector("[data-num]") as HTMLElement;
      expect(b.querySelector(`[data-bar="${c.getAttribute("data-num")}/${c.getAttribute("data-den")}"]`)).not.toBeNull();
    }
    expect(rows[1].querySelector("[data-ring]")).not.toBeNull();
    expect(rows[1].querySelector("[data-arc]")).toBeNull();
  });
});
