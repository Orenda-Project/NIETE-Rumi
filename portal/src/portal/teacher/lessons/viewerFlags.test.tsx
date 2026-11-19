import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * The plan screen's two switches from GET /config (the shared, cached read):
 *   useViewerSlim       features.lpViewerSlim (portal_lp_viewer_slim): on only for a real true; fail closed
 *   useLpWhatsappSend   features.lpWhatsappSend (her programme not in lp_whatsapp_pdf_off): off only for a real false,
 *                       so a server that does not send it yet keeps today's Send on WhatsApp
 */
const cfg = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock("../../lib/useNewUi", () => ({
  peekConfig: () => (cfg.fail ? null : cfg.value),
  readConfigShared: () => (cfg.fail ? Promise.reject(new Error("down")) : Promise.resolve(cfg.value)),
}));
import { useLpWhatsappSend, useViewerSlim } from "./viewerFlags";

beforeEach(() => { cfg.value = null; cfg.fail = false; });

describe("useViewerSlim", () => {
  it("a real true → on, from the first render when /config was already read", () => {
    cfg.value = { features: { lpViewerSlim: true } };
    expect(renderHook(() => useViewerSlim()).result.current).toBe(true);
  });

  it.each([[undefined], [false], ["true"], [1]])("%s → off", async (v) => {
    cfg.value = { features: { lpViewerSlim: v } };
    const { result } = renderHook(() => useViewerSlim());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("no /config or a failed read → off", async () => {
    cfg.fail = true;
    const { result } = renderHook(() => useViewerSlim());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
  });
});

describe("useLpWhatsappSend", () => {
  it("absent or true → allowed; a real false → not", async () => {
    cfg.value = { features: {} };
    expect(renderHook(() => useLpWhatsappSend()).result.current).toBe(true);
    cfg.value = { features: { lpWhatsappSend: true } };
    expect(renderHook(() => useLpWhatsappSend()).result.current).toBe(true);
    cfg.value = { features: { lpWhatsappSend: false } };
    const { result } = renderHook(() => useLpWhatsappSend());
    await waitFor(() => expect(result.current).toBe(false));
  });
});
