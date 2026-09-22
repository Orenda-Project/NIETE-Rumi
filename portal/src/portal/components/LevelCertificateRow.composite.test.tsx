import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * bd-60163 — the certificate row explains the COMPOSITE.
 *
 * An I-SAPS level is certified by three weighted streams, each with its own
 * bar: session questions 25% (bar 50), module-exam questions 50% (bar 60),
 * written answers 25% (bar 50). A teacher must clear all three.
 *
 * So "you have not finished yet" is the wrong refusal: she needs to know WHICH
 * bar she is under, or she cannot tell whether to re-sit an exam or go back to
 * the sessions. Re-takes are unlimited, which is what makes naming it useful.
 *
 * The row must ALSO still work for levels with no composite (Beacon House,
 * Oxbridge) — those fall back to the session counts, and this file holds that
 * fallback in place.
 */

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";
import LevelCertificateRow from "./LevelCertificateRow";

const SHORT = {
  state: "locked", certificate: null,
  units_total: 54, units_done: 54, exams_total: 9, exams_done: 4,
  grade: {
    is_passed: false,
    composite_pct: 38,
    failed_components: ["mcq", "crq"],
    components: {
      formative: { pct: 71, bar: 50, weight: 25, passed: true },
      mcq: { pct: 22, bar: 60, weight: 50, passed: false },
      crq: { pct: 10, bar: 50, weight: 25, passed: false },
    },
  },
};

beforeEach(() => { vi.clearAllMocks(); });

describe("bd-60163 — composite on the certificate row", () => {
  it("shows the composite percentage rather than a session fraction", async () => {
    (api.get as any).mockResolvedValue({ data: SHORT });
    render(<LevelCertificateRow levelId={27} />);
    expect(await screen.findByTestId("level-composite-pct")).toHaveTextContent("38%");
  });

  it("names each stream that is short, with her mark and the bar", async () => {
    (api.get as any).mockResolvedValue({ data: SHORT });
    (api.post as any).mockResolvedValue({ data: { issued: false, ...SHORT } });
    render(<LevelCertificateRow levelId={27} />);
    await userEvent.click(await screen.findByTestId("level-certificate-claim"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const said = toastSpy.mock.calls.map(c => JSON.stringify(c[0])).join(" ");
    expect(said).toMatch(/Module exam questions 22% \(needs 60%\)/);
    expect(said).toMatch(/Written answers 10% \(needs 50%\)/);
    // the stream she has PASSED is not listed as outstanding
    expect(said).not.toMatch(/Session questions/);
    // unlimited re-takes are the point of telling her
    expect(said).toMatch(/as many times as you need/i);
  });

  it("treats the composite, not the session count, as ready", async () => {
    (api.get as any).mockResolvedValue({
      data: { ...SHORT, units_done: 10, grade: { ...SHORT.grade, is_passed: true, failed_components: [] } },
    });
    render(<LevelCertificateRow levelId={27} />);
    // ready styling means the claim button is offered without a shortfall badge
    await screen.findByTestId("level-certificate-claim");
    expect(screen.queryByTestId("level-composite-pct")).not.toBeInTheDocument();
  });

  it("falls back to session counts on a level with no composite", async () => {
    (api.get as any).mockResolvedValue({
      data: { state: "locked", certificate: null, units_total: 7, units_done: 3, grade: null },
    });
    render(<LevelCertificateRow levelId={1} />);
    expect(await screen.findByText("3/7")).toBeInTheDocument();
    expect(screen.queryByTestId("level-composite-pct")).not.toBeInTheDocument();
  });
});
