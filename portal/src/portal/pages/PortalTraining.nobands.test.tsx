/**
 * bd-43487 — a teacher with no training assigned must be told, and be able to fix it.
 *
 * THE BUG THIS ENCODES
 * --------------------
 * `_filterLevelsByScopes` (dashboard/routes/portal.routes.js) returns `[]` when
 * the teacher has no active row in `teacher_training_assignments`. That is a
 * legitimate answer — "nothing is assigned to you" — but the portal rendered it
 * as an empty "Select level..." dropdown with no message and no remedy. The
 * teacher sees a page that looks broken and can do nothing about it.
 *
 * On production (NIETE, checked 2026-08-21) 666 of 9,534 teachers are in exactly
 * this state. It is reported on the partner bug sheet as "training levels are
 * not visible to teacher in the portal".
 *
 * The WhatsApp bot already recovers from this: it shows a band picker so the
 * teacher chooses the grades they teach, and their programs are assigned from
 * that. The backend half for the portal exists too — GET/POST /training/bands
 * (added by bd-43478) — but NOTHING in portal/src ever called it. This is the
 * "defined ≠ live" gap: a shipped API with no way to reach it.
 *
 * WHY THE ASSERTIONS ARE SHAPED THIS WAY
 * --------------------------------------
 * The distinction that matters is between the two ways the list can be empty:
 *
 *   - nothing assigned  → explain it, and offer the picker (recoverable)
 *   - assigned, but the request FAILED → do NOT claim nothing is assigned,
 *     because that is a plausible lie about the teacher's record
 *
 * The second case is the one the old code got wrong in the other direction, and
 * it is why this test asserts the failure path separately.
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

/** The shape GET /training/bands returns for a teacher who has never chosen. */
const BANDS_FIRST_TIME = {
  success: true,
  options: [
    { id: "PRIMARY", title: "Primary (Grades 1-5)" },
    { id: "MIDDLE", title: "Middle (Grades 6-8)" },
    { id: "HIGH", title: "High (Grades 9-10)" },
  ],
  selected: [],
  can_change: true,
  is_first_selection: true,
  hours_remaining: 0,
  notice: null,
};

function mockApi({
  levels = [],
  levelsFails = false,
  bands = BANDS_FIRST_TIME,
}: { levels?: unknown[]; levelsFails?: boolean; bands?: unknown } = {}) {
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: [] } });
    if (url === "/training/levels") {
      return levelsFails
        ? Promise.reject(new Error("Request failed with status code 500"))
        : Promise.resolve({ data: { levels } });
    }
    if (url === "/training/bands") return Promise.resolve({ data: bands });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    return Promise.resolve({ data: {} });
  });
  (api.post as any).mockResolvedValue({
    data: { success: true, programs: ["niete_primary"] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bd-43487 — no training assigned", () => {
  it("explains the empty state instead of showing a bare empty dropdown", async () => {
    mockApi({ levels: [] });
    render(<PortalTraining />);

    const empty = await screen.findByTestId("training-no-assignment");
    expect(empty).toBeInTheDocument();
    // The teacher must learn WHY the page is empty.
    expect(empty.textContent || "").toMatch(/grades you teach|no training/i);
  });

  it("offers the band picker, which the backend has always exposed", async () => {
    mockApi({ levels: [] });
    render(<PortalTraining />);

    expect(await screen.findByTestId("band-picker")).toBeInTheDocument();
    // Every band the API offered is selectable.
    expect(screen.getByTestId("band-option-PRIMARY")).toBeInTheDocument();
    expect(screen.getByTestId("band-option-MIDDLE")).toBeInTheDocument();
    expect(screen.getByTestId("band-option-HIGH")).toBeInTheDocument();
  });

  it("saves the choice to POST /training/bands and reloads the levels", async () => {
    mockApi({ levels: [] });
    render(<PortalTraining />);

    await screen.findByTestId("band-picker");
    await userEvent.click(screen.getByTestId("band-option-PRIMARY"));
    await userEvent.click(screen.getByTestId("band-save"));

    await waitFor(() => {
      expect(api.post as any).toHaveBeenCalledWith("/training/bands", {
        bands: ["PRIMARY"],
      });
    });
    // A successful save must re-pull the catalogue, otherwise the teacher saves
    // and the page still looks empty.
    await waitFor(() => {
      const urls = (api.get as any).mock.calls.map((c: unknown[]) => c[0]);
      expect(urls.filter((u: string) => u === "/training/levels").length).toBeGreaterThan(1);
    });
  });

  it("does NOT claim 'nothing assigned' when the request actually failed", async () => {
    mockApi({ levelsFails: true });
    render(<PortalTraining />);

    // Give the page a chance to settle into the wrong state.
    await waitFor(() => {
      expect((api.get as any).mock.calls.length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("training-no-assignment")).not.toBeInTheDocument();
    });
  });

  it("shows the normal picker, and no empty-state, when levels do exist", async () => {
    mockApi({
      levels: [{
        id: 1, name: "Aspiring Teacher", order_index: 0, cpd_level: null,
        vendor_key: "TALEEMABAD", unlock_logic: "chain", state: "not_started",
        module_count: 3, completed_count: 0, courses_total: 1, courses_completed: 0,
      }],
    });
    render(<PortalTraining />);

    await waitFor(() => {
      expect(screen.queryByTestId("training-no-assignment")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("band-picker")).not.toBeInTheDocument();
  });
});
