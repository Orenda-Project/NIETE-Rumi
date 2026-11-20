import { describe, it, expect, vi, afterEach } from "vitest";
import { reportViewerFailure, viewerReasonOf } from "./lpViewerReport";

// bd-zrdvmi.21 — the lesson-plan reader's failure report: why a step failed, and a send that never throws.
describe("viewerReasonOf", () => {
  it("names an HTTP status, a timeout, a dropped connection, an abort, or the error's own name", () => {
    expect(viewerReasonOf({ response: { status: 502 } })).toEqual({ reason: "http", status: 502, errName: null });
    expect(viewerReasonOf({ code: "ECONNABORTED", message: "timeout of 120000ms exceeded" })).toEqual({ reason: "timeout", status: null, errName: null });
    expect(viewerReasonOf({ code: "ERR_NETWORK", message: "Network Error" })).toEqual({ reason: "network", status: null, errName: null });
    expect(viewerReasonOf({ code: "ERR_CANCELED", name: "CanceledError" }).reason).toBe("abort");
    expect(viewerReasonOf(Object.assign(new Error("bad"), { name: "InvalidPDFException" }))).toEqual({ reason: "unknown", status: null, errName: "InvalidPDFException" });
    expect(viewerReasonOf(new Error("plain"))).toEqual({ reason: "unknown", status: null, errName: null });
    expect(viewerReasonOf(undefined)).toEqual({ reason: "unknown", status: null, errName: null });
  });
});

describe("reportViewerFailure", () => {
  afterEach(() => vi.unstubAllGlobals());
  const F = { stage: "draw" as const, lane: "g612" as const, reason: "unknown" as const, status: null, errName: null,
    sizeBytes: 1, pages: 2, pageWidth: 390, pageHeight: 4469, elapsedMs: 5, online: true };

  it("posts the report as text to /funnel/lp-viewer-failed, kept alive", () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    reportViewerFailure(F);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/funnel\/lp-viewer-failed$/);
    expect(init).toEqual(expect.objectContaining({ method: "POST", keepalive: true, credentials: "include" }));
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ stage: "draw", pageHeight: 4469 }));
  });

  it("never throws, whatever fetch does", () => {
    vi.stubGlobal("fetch", () => { throw new Error("no fetch"); });
    expect(() => reportViewerFailure(F)).not.toThrow();
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    expect(() => reportViewerFailure(F)).not.toThrow();
  });
});
