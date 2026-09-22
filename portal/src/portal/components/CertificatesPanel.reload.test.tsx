/**
 * bd-60172 — a certificate you just earned is on the shelf without a reload.
 *
 * Reported from sandbox: "i had to reload the page to get my cert."
 *
 * Two independent reasons, and either alone is enough to cause it:
 *
 *  1. CertificatesPanel.load() opens with `if (loaded || loading) return` —
 *     "fetched once per session". Sensible for the collapsed DRAWER it was
 *     written for (toggling it open and shut should not re-hit the API), but
 *     the shelf mounts open and never unmounts, so that latch makes it
 *     permanently stale: nothing minted after the first fetch can ever show.
 *
 *  2. LevelCertificateRow's onIssued was wired to refreshLevels, which GETs
 *     /training/levels. The shelf renders from /training/certificates. The
 *     refresh and the stale data were never the same request.
 *
 * The fix is a reloadKey the parent bumps on issue. Asserted here at the
 * component's own seam — a changed key refetches, an unchanged one does not,
 * so the latch still does its real job.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: vi.fn(() => "/api/portal"),
  isNativeApp: vi.fn(() => false),
}));
import api from "../services/api";
import CertificatesPanel from "./CertificatesPanel";

const URL = "/training/certificates";

const LEVELS = [{ id: 26, name: "Level 1: Novice", module_count: 9, completed_count: 9 }];

const FRESH = {
  id: "cert-fresh",
  certificate_code: "CERT-20260922-VAX3YR",
  level_name: "Level 1: Novice",
  teacher_name: "Hataf",
  issued_at: "2026-09-22T08:04:49Z",
  has_pdf: true,
  download_url: "/api/portal/training/certificates/CERT-20260922-VAX3YR/download",
};

describe("bd-60172 — the shelf refetches when a certificate is issued", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a certificate minted after the first fetch, without a remount", async () => {
    // First fetch: nothing earned yet — the level is pending.
    (api.get as any).mockResolvedValueOnce({ data: { success: true, certificates: [] } });
    // Second fetch, after the claim: the certificate exists.
    (api.get as any).mockResolvedValueOnce({ data: { success: true, certificates: [FRESH] } });

    const { rerender } = render(
      <CertificatesPanel alwaysOpen levels={LEVELS} reloadKey={0} />
    );

    await waitFor(() =>
      expect(screen.getByTestId("certificates-earned-count")).toHaveTextContent("0 of 1 earned")
    );

    // The teacher taps "Receive Certificate"; the page bumps the key.
    rerender(<CertificatesPanel alwaysOpen levels={LEVELS} reloadKey={1} />);

    await waitFor(() =>
      expect(screen.getByTestId("certificates-earned-count")).toHaveTextContent("1 of 1 earned")
    );
    expect(screen.getByText("CERT-20260922-VAX3YR")).toBeInTheDocument();
    expect((api.get as any).mock.calls.filter((c: any[]) => c[0] === URL)).toHaveLength(2);
  });

  it("does not refetch when the key is unchanged — the latch still holds", async () => {
    (api.get as any).mockResolvedValue({ data: { success: true, certificates: [FRESH] } });

    const { rerender } = render(
      <CertificatesPanel alwaysOpen levels={LEVELS} reloadKey={7} />
    );
    await waitFor(() =>
      expect(screen.getByTestId("certificates-earned-count")).toHaveTextContent("1 of 1 earned")
    );

    rerender(<CertificatesPanel alwaysOpen levels={LEVELS} reloadKey={7} />);
    rerender(<CertificatesPanel alwaysOpen levels={LEVELS} reloadKey={7} />);

    expect((api.get as any).mock.calls.filter((c: any[]) => c[0] === URL)).toHaveLength(1);
  });
});
