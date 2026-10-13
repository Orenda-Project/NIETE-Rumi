import { describe, it, expect, vi, beforeEach } from "vitest";

/** bd-s6qbts.3 — analytics.getSchools is GET /api/portal/analytics/schools with the window and region (PLAN v3 §3). */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("axios", () => {
  const instance = {
    interceptors: { response: { use: () => {} } },
    get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  };
  return { default: { create: () => instance } };
});

import { analytics } from "./api";

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: { success: true, schools: [] } });
});

describe("analytics.getSchools", () => {
  it("sends the window and the region", async () => {
    const out = await analytics.getSchools({ from: "2026-10-01", to: "2026-10-13", region: "B.K" });
    expect(get).toHaveBeenCalledWith("/analytics/schools", { params: { from: "2026-10-01", to: "2026-10-13", region: "B.K" } });
    expect(out).toEqual({ success: true, schools: [] });
  });

  it("an open window is left out, and no region means all of them", async () => {
    await analytics.getSchools({ from: null, to: null, region: null });
    expect(get).toHaveBeenCalledWith("/analytics/schools", { params: { region: "all" } });
  });
});
