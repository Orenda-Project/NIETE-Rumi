/**
 * A teacher who ALREADY has training must be able to correct their level too.
 *
 * THE GAP THIS ENCODES
 * --------------------
 * The portal's BandPicker was mounted only behind `levels.length === 0`, so it
 * served the "nothing assigned" case and nothing else. A teacher whose bands
 * were simply WRONG — the original partner report: teaching primary and middle
 * but enrolled in the primary programme only, so no Oxbridge or Beacon House —
 * had no way to fix it on the portal. The WhatsApp bot had the entry point; the
 * portal did not, even though GET/POST /training/bands served both.
 *
 * So the assertions here are the mirror image of the nobands suite: with levels
 * present, the edit entry point exists, and opening it reaches the SAME picker.
 *
 * The label is "Edit Teacher Level" (operator's wording, 2026-08-21) on both the
 * portal and the WhatsApp Flow, so the two surfaces read the same.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTraining from "./PortalTraining";

/** A teacher who HAS chosen: bands set, and the 48h window is open. */
const BANDS_SET = {
  success: true,
  options: [
    { id: "PRIMARY", title: "Primary (Grades 1-5)" },
    { id: "MIDDLE", title: "Middle (Grades 6-8)" },
    { id: "HIGH", title: "High (Grades 9-10)" },
  ],
  selected: ["PRIMARY"],
  can_change: true,
  is_first_selection: false,
  hours_remaining: 0,
  notice: "Once you save this, it cannot be changed again for 48 hours.",
};

const LEVEL = {
  id: 3,
  name: "Skilled Practitioner",
  order_index: 2,
  state: "not_started",
  vendor_key: "TALEEMABAD",
  courses_total: 9,
  courses_completed: 0,
};

function mockApi({ levels = [LEVEL], bands = BANDS_SET } = {}) {
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors")
      return Promise.resolve({ data: { vendors: [{ key: "TALEEMABAD", name: "NIETE" }] } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels } });
    if (url === "/training/bands") return Promise.resolve({ data: bands });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    return Promise.resolve({ data: {} });
  });
  (api.post as any).mockResolvedValue({
    data: { success: true, programs: ["niete_primary", "niete_middle_high"] },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("a teacher WITH training can still edit their level", () => {
  it("offers the edit entry point", async () => {
    mockApi();
    render(<PortalTraining />);
    expect(await screen.findByTestId("training-edit-bands")).toBeInTheDocument();
    expect(screen.getByTestId("training-edit-bands-toggle")).toHaveTextContent(
      /Edit Teacher Level/i,
    );
  });

  it("does NOT show the no-training empty state — that is a different case", async () => {
    mockApi();
    render(<PortalTraining />);
    await screen.findByTestId("training-edit-bands");
    expect(screen.queryByTestId("training-no-assignment")).not.toBeInTheDocument();
  });

  it("keeps the picker collapsed until asked — it is a correction, not a gate", async () => {
    mockApi();
    render(<PortalTraining />);
    await screen.findByTestId("training-edit-bands");
    expect(screen.queryByTestId("band-picker")).not.toBeInTheDocument();
  });

  it("opens the same picker, pre-selecting what the teacher already has", async () => {
    mockApi();
    render(<PortalTraining />);
    await userEvent.click(await screen.findByTestId("training-edit-bands-toggle"));

    expect(await screen.findByTestId("band-picker")).toBeInTheDocument();
    // Pre-selection comes from the server's `selected`, so the teacher edits
    // from their real state rather than an empty form.
    await waitFor(() =>
      expect(screen.getByTestId("band-option-PRIMARY")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByTestId("band-option-MIDDLE")).toHaveAttribute("aria-pressed", "false");
  });

  it("adding a band posts the full selection", async () => {
    mockApi();
    render(<PortalTraining />);
    await userEvent.click(await screen.findByTestId("training-edit-bands-toggle"));
    await screen.findByTestId("band-picker");

    await userEvent.click(screen.getByTestId("band-option-MIDDLE"));
    await userEvent.click(screen.getByTestId("band-save"));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = (api.post as any).mock.calls[0];
    expect(url).toBe("/training/bands");
    // Both bands, not just the newly ticked one — the API replaces the set.
    expect([...body.bands].sort()).toEqual(["MIDDLE", "PRIMARY"]);
  });

  it("shows the server's cooldown notice rather than deriving one", async () => {
    mockApi();
    render(<PortalTraining />);
    await userEvent.click(await screen.findByTestId("training-edit-bands-toggle"));
    const notice = await screen.findByTestId("band-notice");
    expect(notice).toHaveTextContent(/48 hours/i);
  });

  it("disables the picker when the server says the change is blocked", async () => {
    mockApi({
      bands: {
        ...BANDS_SET,
        can_change: false,
        hours_remaining: 47,
        notice:
          "You changed the grades you teach less than 48 hours ago, so this cannot be changed " +
          "again just yet. If you need it changed sooner, please reach out to NIETE Support.",
      },
    });
    render(<PortalTraining />);
    await userEvent.click(await screen.findByTestId("training-edit-bands-toggle"));
    await screen.findByTestId("band-picker");

    expect(screen.getByTestId("band-save")).toBeDisabled();
    expect(screen.getByTestId("band-option-MIDDLE")).toBeDisabled();
    expect(screen.getByTestId("band-notice")).toHaveTextContent(/NIETE Support/i);
  });
});
