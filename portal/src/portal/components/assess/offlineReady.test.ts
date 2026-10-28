import { describe, it, expect } from "vitest";
import { pageUrls, listUrl } from "./offlineReady";

// Round 8 (sa_r8_offline_prep): what "Get ready" keeps for the page to open again with no signal.
describe("pageUrls", () => {
  it("the page, the reads it makes on the way in, the prepared lists, and the engine's offline helper this page loads", () => {
    const l = listUrl("s2", "v2", 3);
    const u = pageUrls([l]);
    expect(u[0]).toBe("/portal/leader/assess");
    for (const want of ["/api/portal/me", "/api/portal/config", "/api/portal/leader/child-test/sa/switches", "/api/portal/leader/child-test/sa/schools", l, "/sa/sa-offline.js"]) {
      expect(u).toContain(want);
    }
  });
});
