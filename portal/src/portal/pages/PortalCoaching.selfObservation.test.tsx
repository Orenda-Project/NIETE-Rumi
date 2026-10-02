import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-3bvfj — "Analyse a lesson" ships dark. The button on Coaching Sessions
// appears only when /config says the feature is on for this teacher.

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getCoachingSessions: vi.fn().mockResolvedValue({ sessions: [], pagination: {} }),
    getConfig: vi.fn(),
  },
}));

import { portal } from "../services/api";
import PortalCoaching from "./PortalCoaching";

const api = portal as any;

function renderPage() {
  render(<MemoryRouter><PortalCoaching /></MemoryRouter>);
}

/**
 * Let /config's answer (resolved OR rejected) reach state before asserting the
 * button is ABSENT — checking straight after the first render passes whatever
 * the code does with the answer (proved by mutation: a catch that turned the
 * feature ON still passed).
 */
async function settled() {
  await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/Coaching Sessions/)).toBeInTheDocument());
  await new Promise((r) => setTimeout(r, 50));
}

beforeEach(() => vi.clearAllMocks());

describe("the Analyse a lesson entry point", () => {
  it("is hidden when the feature is off", async () => {
    api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: false } });
    renderPage();
    await settled();
    expect(screen.queryByTestId("analyse-lesson")).toBeNull();
  });

  it("is hidden when /config cannot be read", async () => {
    api.getConfig.mockRejectedValue(new Error("down"));
    renderPage();
    await settled();
    expect(screen.queryByTestId("analyse-lesson")).toBeNull();
  });

  it("shows, linking to the upload page, when the feature is on for her", async () => {
    api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: true } });
    renderPage();
    const link = await screen.findByTestId("analyse-lesson");
    expect(link).toHaveAttribute("href", "/portal/coaching/new");
  });
});
