import { describe, it, expect, vi } from "vitest";

/**
 * bd-5rz1v.12 — when /config cannot be reached, the portal assumes every
 * feature is OFF. The new UI is one of them: the fallback must say
 * newUi: false, never leave it to chance. Mocked at the network boundary
 * (axios), so the real getConfig runs.
 */

vi.mock("axios", () => {
  const instance = {
    get: vi.fn().mockRejectedValue(new Error("network down")),
    post: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } },
  };
  return { default: { create: () => instance } };
});

import { portal } from "./api";

describe("portal.getConfig fallback", () => {
  it("says newUi: false when /config fails", async () => {
    const cfg = await portal.getConfig();
    expect(cfg.features.newUi).toBe(false);
  });

  it("keeps every other feature off too", async () => {
    const cfg = await portal.getConfig();
    expect(cfg.features).toMatchObject({
      assessmentGenerator: false, selfObservation: false, coachObservation: false, newUi: false,
    });
  });
});
