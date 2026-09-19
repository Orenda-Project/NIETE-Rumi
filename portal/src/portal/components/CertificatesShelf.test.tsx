/**
 * bd-60154 — the certificates SHELF.
 *
 * The old section was a drawer of earned certificates only, so a teacher with
 * none clicked "My certificates" to be told she had none, over a line telling
 * her to go and pass an exam on WhatsApp — which is no longer where exams
 * happen. Three promises are made here, and each was a live defect:
 *
 *   1. unearned levels are listed, with the work left on them named;
 *   2. the shelf is open on arrival — it never hides its own subject;
 *   3. the WhatsApp instruction is gone.
 *
 * The fourth test is the one that protects everyone else: v1 passes no
 * `levels`, and must keep the exact drawer it has today. 9,534 teachers are
 * on that page.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";

vi.mock("@/lib/runtime", () => ({
  getApiBaseUrl: () => "",
  isNativeApp: () => false,
}));

import CertificatesPanel from "./CertificatesPanel";

const LEVELS = [
  { id: 27, name: "I-SAPS Level 1", module_count: 54, completed_count: 18 },
  { id: 28, name: "Aspiring Teacher", module_count: 12, completed_count: 0 },
];

const EARNED = [{
  id: "c1",
  certificate_code: "NIETE-L5-20260720-4E1053",
  level_name: "I-SAPS Level 1",
  teacher_name: "Mashhood",
  issued_at: "2026-07-20T08:52:43Z",
  has_pdf: true,
  download_url: "/api/portal/training/certificates/NIETE-L5-20260720-4E1053/download",
}];

function mockCerts(list: unknown[]) {
  (api.get as any).mockImplementation((url: string) =>
    url === "/training/certificates"
      ? Promise.resolve({ data: { certificates: list } })
      : Promise.resolve({ data: {} }),
  );
}

beforeEach(() => { vi.clearAllMocks(); mockCerts([]); });

describe("bd-60154 — certificates shelf", () => {
  it("opens without a click and lists levels not yet earned", async () => {
    render(<CertificatesPanel alwaysOpen levels={LEVELS} />);
    // No click: the panel is the section, not a drawer.
    const rows = await screen.findAllByTestId("certificate-pending-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("I-SAPS Level 1")).toBeInTheDocument();
  });

  it("names the work outstanding on an unearned level", async () => {
    render(<CertificatesPanel alwaysOpen levels={LEVELS} />);
    expect(await screen.findByText(/18 of 54 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/36 to go/)).toBeInTheDocument();
  });

  it("never sends the teacher to WhatsApp — exams run in the portal", async () => {
    render(<CertificatesPanel alwaysOpen levels={LEVELS} />);
    await screen.findAllByTestId("certificate-pending-row");
    expect(screen.queryByText(/WhatsApp/i)).not.toBeInTheDocument();
  });

  it("does not list a level twice once its certificate is earned", async () => {
    mockCerts(EARNED);
    render(<CertificatesPanel alwaysOpen levels={LEVELS} />);
    // I-SAPS is earned, so only "Aspiring Teacher" remains pending.
    const rows = await screen.findAllByTestId("certificate-pending-row");
    expect(rows).toHaveLength(1);
    expect(await screen.findByTestId("certificates-earned-count")).toHaveTextContent("1 of 2 earned");
  });

  it("leaves v1 as a collapsed drawer when no levels are passed", async () => {
    render(<CertificatesPanel />);
    // The toggle still exists and the panel starts CLOSED — v1's contract.
    expect(screen.getByTestId("certificates-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("certificates-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("certificate-pending-row")).not.toBeInTheDocument();
  });
});
