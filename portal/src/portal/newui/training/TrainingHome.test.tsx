import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { CERTIFICATES, VENDORS, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — the Training page with the new UI on (deep-screens.html, Training 1):
 *
 *   the flat indigo heading "Training" with the graduation-cap tile, and on the band the
 *   provider she is continuing with its % ("NIETE 24%") and her certificate count;
 *   a row per provider: a neutral initials badge, the name, a green bar, the % (a check when
 *   done) — NIETE, I-SAPS, Beacon House, Oxbridge, in that order;
 *   a Certificates row with its count;
 *   the green "Continue NIETE" at the bottom, straight to the part she was last on.
 * "My grades" is not on this page — unless nothing is assigned, when it is the way out.
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  portal: { getConfig: vi.fn() },
}));

import { useAuth } from "../../hooks/useAuth";
import api, { portal } from "../../services/api";
import PortalTrainingPage from "../../pages/PortalTrainingPage";
import { TRAINING_ROUTES } from "../../lib/trainingRoutes";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />)}
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", lastName: "Khan", role: "teacher", phoneNumber: "923001234567" },
    loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(trainingGet() as never);
});

const rows = () => within(screen.getByRole("list", { name: "Providers" })).getAllByRole("listitem");

describe("the heading", () => {
  it("is the flat indigo band: 'Training' and the graduation-cap tile", async () => {
    renderAt("/portal/training");
    expect(await screen.findByRole("heading", { level: 1, name: "Training" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-main-heading")).toBeInTheDocument();
    expect(screen.getByTestId("newui-heading-tile")).toBeInTheDocument();
    expect(screen.queryByTestId("training-v2-root")).not.toBeInTheDocument();
  });

  it("carries her certificate count and, once known, the provider she continues with its %", async () => {
    renderAt("/portal/training");
    const band = await screen.findByTestId("newui-heading-context");
    await waitFor(() => expect(within(band).getByText("NIETE 24%")).toBeInTheDocument());
    expect(within(band).getByText(String(CERTIFICATES.length))).toBeInTheDocument();
  });
});

describe("the providers", () => {
  it("one row each, NIETE, I-SAPS, Beacon House, Oxbridge — initials badge, name, green bar, %", async () => {
    renderAt("/portal/training");
    await screen.findByText("Beacon House");
    const r = rows();
    expect(r.map((li) => li.querySelector("[data-testid=newui-row-tile]")?.textContent)).toEqual(["N", "IS", "BH", "OX"]);
    ["NIETE", "I-SAPS", "Beacon House", "Oxbridge"].forEach((name, i) => expect(within(r[i]).getByText(name)).toBeInTheDocument());
    expect(r.map((li) => within(li).getByRole("progressbar").getAttribute("aria-valuenow"))).toEqual(["24", "11", "1", "100"]);
    expect(within(r[0]).getByText("24%")).toBeInTheDocument();
    // Done: a check in place of the number.
    expect(within(r[3]).getByLabelText("Done")).toBeInTheDocument();
    expect(within(r[3]).queryByText("100%")).not.toBeInTheDocument();
    // The badge is neutral, never a provider's colour.
    for (const li of r) expect(li.querySelector("[data-testid=newui-row-tile]")?.className).toContain("bg-nu-neutral-tile");
  });

  it("a ladder opens its levels; a one-level provider (I-SAPS, Oxbridge) skips straight to its level", async () => {
    renderAt("/portal/training");
    await screen.findByText("Beacon House");
    const hrefs = rows().map((li) => li.querySelector("a")?.getAttribute("href"));
    expect(hrefs).toEqual([
      "/portal/training/provider/TALEEMABAD",
      "/portal/training/provider/ISAPS/level/9",
      "/portal/training/provider/BEACONHOUSE",
      "/portal/training/provider/OXBRIDGE/level/17",
    ]);
  });

  it("a Certificates row with her count, to the certificates page", async () => {
    renderAt("/portal/training");
    const link = await screen.findByRole("link", { name: /Certificates/ });
    expect(link).toHaveAttribute("href", "/portal/training/certificates");
    await waitFor(() => expect(within(link).getByText(String(CERTIFICATES.length))).toBeInTheDocument());
  });

  it("no band picker here: My grades lives in the account sheet", async () => {
    renderAt("/portal/training");
    await screen.findByText("Beacon House");
    expect(screen.queryByText(/My grades/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("band-picker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("training-edit-bands")).not.toBeInTheDocument();
  });
});

describe("Continue", () => {
  it("is the green bottom button, 'Continue NIETE', to the part she was last on", async () => {
    renderAt("/portal/training");
    const cta = await screen.findByRole("link", { name: "Continue NIETE" });
    expect(cta).toHaveAttribute("href", "/portal/training/unit/m-4");
    expect(cta.className).toContain("bg-nu-button");
    expect(screen.getByTestId("newui-bottom-actions")).toContainElement(cta);
  });

  it("is not offered when every level is certified or locked", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/levels": { levels: [{ id: 1, name: "Aspiring", vendor_key: "TALEEMABAD", order_index: 0, state: "certified", unlock_logic: "chain", module_count: 3, completed_count: 3, courses_total: 1, courses_completed: 1, passed_at: null, cooldown_until: null, previous_level_order: null, cpd_level: null }] },
      "/training/vendors": { vendors: [VENDORS[3]] },
    }) as never);
    renderAt("/portal/training");
    await screen.findByText("NIETE");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/training/certificates", undefined));
    expect(screen.queryByRole("link", { name: /Continue/ })).not.toBeInTheDocument();
  });
});

describe("nothing assigned", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/levels": { levels: [] },
      "/training/vendors": { vendors: [] },
      "/training/certificates": { certificates: [] },
    }) as never);
  });

  it("says so in two words and offers My grades, the way out — no Continue", async () => {
    renderAt("/portal/training");
    expect(await screen.findByText("No training yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /My grades/ })).toHaveAttribute("href", "/portal/training/grades");
    expect(screen.queryByRole("link", { name: /Continue/ })).not.toBeInTheDocument();
  });
});

describe("loading and failing", () => {
  it("while loading: a spinner hero, never a 0 that is not true", async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    renderAt("/portal/training");
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("when the levels do not load: 'Not loaded' and Try again, which asks again", async () => {
    const get = trainingGet({ "/training/levels": new Error("network") });
    vi.mocked(api.get).mockImplementation(get as never);
    renderAt("/portal/training");
    expect(await screen.findByText("Not loaded")).toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(trainingGet() as never);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(await screen.findByText("Beacon House")).toBeInTheDocument();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words (chips, labels, buttons) are labels — data is not copy", async () => {
    renderAt("/portal/training");
    await screen.findByRole("link", { name: "Continue NIETE" });
    expect(tapProblems(document.body)).toEqual([]);
    const texts = Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button")).map((el) => el.textContent?.trim() || "");
    for (const t of texts) expect(copyProblem(t), t).toBeNull();
  });
});
