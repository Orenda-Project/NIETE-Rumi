import { describe, it, expect } from "vitest";
import { dcKpiItems, type DcItem } from "./api";
import { COACHING_V2_COPY as C } from "./copy";

/**
 * Queue #282 / bd-ra8xu.64.2 — the Coaching home "Latest band" tile is her NEWEST report's band. A report scored on
 * FICO17 v6 has no V3 percentage, so no band: the tile says "—" instead of reaching back to an older V3 lesson's band.
 */
const item = (o: Partial<DcItem>): DcItem => ({ id: "x", date: "2026-11-01", topic: null, subject: null, grade: null, minutes: 30, percentage: null, reportReady: true, ...o });
const history = (items: DcItem[]) => ({
  kpis: { sessions: { value: items.length, previous: null }, minutes: { value: 0, previous: null }, reports: { value: items.length, previous: null } },
  trend: { bucketDays: 1, points: [] },
  items,
});

describe("Latest band: the newest report only (queue #282 / bd-ra8xu.64.2)", () => {
  it("newest report is v6 (no band): '—', never the older V3 lesson's band", () => {
    const tiles = dcKpiItems(history([item({ id: "v6", date: "2026-11-24", percentage: null }), item({ id: "v3", date: "2026-11-10", percentage: 85 })]), C);
    expect(tiles[1]).toMatchObject({ label: C.kpiLatestBand, value: "—" });
  });
  it("a lesson still being analysed is not a report: the newest READY report's band", () => {
    const tiles = dcKpiItems(history([item({ id: "a", date: "2026-11-25", reportReady: false }), item({ id: "v3", date: "2026-11-10", percentage: 85 })]), C);
    expect(tiles[1].value).toBe(C.bands.excellent);
  });
  it("no report yet: '—'", () => {
    expect(dcKpiItems(history([]), C)[1].value).toBe("—");
  });
});
