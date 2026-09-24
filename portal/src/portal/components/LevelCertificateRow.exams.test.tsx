import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The I-SAPS certificate card: module exams are the ONLY gate.
 *
 * Operator, 2026-09-23: no chaining between units or modules; the certificate
 * ships once every module exam is passed, and nothing else is checked. This
 * supersedes bd-60163's composite row (LevelCertificateRow.composite.test.tsx,
 * removed in the same change): the weighted score no longer decides, so the
 * row must not show it.
 *
 * On a level with module exams the row is a card with a progress bar —
 * "3 of 9 module exams passed". A level with none (Beacon House, Oxbridge)
 * keeps the one-line row and its session counts.
 */

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";
import LevelCertificateRow from "./LevelCertificateRow";

const LOCKED = {
  state: "locked", certificate: null,
  units_total: 54, units_done: 2, exams_total: 9, exams_done: 3, grade: null,
};

beforeEach(() => { vi.clearAllMocks(); });

describe("certificate card on a module-exam level", () => {
  it("shows exams passed out of total, with a progress bar", async () => {
    (api.get as any).mockResolvedValue({ data: LOCKED });
    render(<LevelCertificateRow levelId={27} />);
    expect(await screen.findByTestId("level-certificate-progress")).toHaveTextContent("3 of 9 module exams passed");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "9");
  });

  it("does not mention units or a weighted score", async () => {
    (api.get as any).mockResolvedValue({
      data: { ...LOCKED, grade: { is_passed: false, composite_pct: 38, failed_components: ["mcq"], components: {} } },
    });
    render(<LevelCertificateRow levelId={27} />);
    await screen.findByTestId("level-certificate-progress");
    expect(screen.queryByTestId("level-composite-pct")).not.toBeInTheDocument();
    expect(screen.queryByText(/2\/54/)).not.toBeInTheDocument();
  });

  it("is ready once every exam is passed, whatever the units say", async () => {
    (api.get as any).mockResolvedValue({ data: { ...LOCKED, units_done: 0, exams_done: 9 } });
    render(<LevelCertificateRow levelId={27} />);
    expect(await screen.findByTestId("level-certificate-claim")).toHaveTextContent(/Receive certificate/i);
    expect(screen.getByTestId("level-certificate-claim")).toHaveAttribute("data-ready", "true");
  });

  it("is NOT ready with every unit done but an exam outstanding", async () => {
    (api.get as any).mockResolvedValue({ data: { ...LOCKED, units_done: 54, exams_done: 8 } });
    render(<LevelCertificateRow levelId={27} />);
    expect(await screen.findByTestId("level-certificate-claim")).toHaveAttribute("data-ready", "false");
  });

  it("refused on tap: names the exams left, never sessions", async () => {
    (api.get as any).mockResolvedValue({ data: LOCKED });
    (api.post as any).mockResolvedValue({ data: { issued: false, ...LOCKED } });
    render(<LevelCertificateRow levelId={27} />);
    await userEvent.click(await screen.findByTestId("level-certificate-claim"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const said = JSON.stringify(toastSpy.mock.calls[0][0]);
    expect(said).toMatch(/6 module exams/);
    expect(said).not.toMatch(/session/);
  });

  it("a level with no module exams keeps the session-count row", async () => {
    (api.get as any).mockResolvedValue({
      data: { state: "locked", certificate: null, units_total: 7, units_done: 3, grade: null },
    });
    render(<LevelCertificateRow levelId={1} />);
    expect(await screen.findByText("3/7")).toBeInTheDocument();
    expect(screen.queryByTestId("level-certificate-progress")).not.toBeInTheDocument();
  });
});
