/** bd-sex15q.34 — the shared /config read takes index.html's boot read instead of asking again. */
import { vi } from "vitest";

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock("@/portal/services/api", async (orig) => {
  const real = await orig<typeof import("@/portal/services/api")>();
  return { ...real, portal: { ...real.portal, getConfig } };
});

import { forgetConfig, readConfigShared } from "./useNewUi";

describe("readConfigShared at boot", () => {
  beforeEach(() => { forgetConfig(); getConfig.mockReset(); getConfig.mockResolvedValue({ success: true, features: { coachip: false } }); });
  afterEach(() => { delete (window as { __nieteBoot?: unknown }).__nieteBoot; });

  it("uses the boot read: no second /config", async () => {
    (window as { __nieteBoot?: unknown }).__nieteBoot = { config: Promise.resolve({ success: true, features: { coachip: true } }) };
    expect(await readConfigShared()).toEqual({ success: true, features: { coachip: true } });
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("a boot read that failed (null): asks as before", async () => {
    (window as { __nieteBoot?: unknown }).__nieteBoot = { config: Promise.resolve(null) };
    expect(await readConfigShared()).toEqual({ success: true, features: { coachip: false } });
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("no boot read: asks as before", async () => {
    await readConfigShared();
    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});
