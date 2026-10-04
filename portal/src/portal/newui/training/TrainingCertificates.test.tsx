import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { CERTIFICATES, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — Certificates (deep-screens.html, Training 9): FilterChips "All 4" and one per
 * provider ("NIETE 1", "Beacon 2", "Oxbridge 1"; the picked one indigo), then a row each: a
 * neutral award icon, "NIETE · Aspiring", a date chip, a download action.
 *
 * View and Download keep CertificatesPanel's rules (bd-2397, bd-2676):
 *   web      a tap offers View (in place, ?view=1) and Download (a new tab)
 *   the app  no View (no PDF viewer in the WebView) and NO _blank (external Chrome has no session):
 *            a tap downloads in place, with the API's origin on the url
 */

configure({ asyncUtilTimeout: 5000 });

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  portal: { getConfig: vi.fn() },
}));
const runtime = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/runtime", () => ({
  isNativeApp: () => runtime.native,
  getApiBaseUrl: () => (runtime.native ? "https://portal-sandbox.up.railway.app/api/portal" : "/api/portal"),
}));

import { useAuth } from "../../hooks/useAuth";
import api, { portal } from "../../services/api";
import PortalTrainingPage from "../../pages/PortalTrainingPage";
import { TRAINING_ROUTES } from "../../lib/trainingRoutes";

function renderAt(path = "/portal/training/certificates") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />)}
      </Routes>
    </MemoryRouter>,
  );
}

let clicks: Array<{ href: string; target: string }>;

beforeEach(() => {
  vi.clearAllMocks();
  runtime.native = false;
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute("href") || "", target: this.target });
  });
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(trainingGet() as never);
});
afterEach(() => vi.restoreAllMocks());

const rows = () => within(screen.getByRole("list", { name: "Certificates" })).getAllByRole("listitem");

describe("the list", () => {
  it("the light bar, title 'Certificates'; filters All 4 / NIETE 1 / Beacon 2 / Oxbridge 1, All picked", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { level: 1, name: "Certificates" })).toBeInTheDocument();
    const filters = await screen.findByRole("radiogroup", { name: "Providers" });
    expect(within(filters).getAllByRole("radio").map((r) => r.textContent)).toEqual(["All 4", "NIETE 1", "Beacon 2", "Oxbridge 1"]);
    expect(within(filters).getByRole("radio", { name: "All 4" })).toHaveAttribute("aria-checked", "true");
  });

  it("a row each: neutral award icon, 'NIETE · Aspiring', a date chip, newest first", async () => {
    renderAt();
    await screen.findByText("NIETE · Aspiring");
    const r = rows();
    expect(r.map((li) => li.querySelector("[data-chip]")?.textContent)).toEqual(["3 Oct", "20 Sep", "11 Sep", "2 Sep"]);
    expect(within(r[1]).getByText("Beacon · English")).toBeInTheDocument();
    expect(r[0].querySelector("[data-testid=newui-row-tile]")?.className).toContain("bg-nu-neutral-tile");
  });

  it("a provider chip filters, and is indigo once picked", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("radio", { name: "Beacon 2" }));
    expect(screen.getByRole("radio", { name: "Beacon 2" })).toHaveAttribute("aria-checked", "true");
    expect(rows().map((li) => li.textContent)).toEqual([expect.stringContaining("Beacon · English"), expect.stringContaining("Beacon · Maths")]);
  });

  it("none yet: Nothing yet", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({ "/training/certificates": { certificates: [] } }) as never);
    renderAt();
    expect(await screen.findByText("Nothing yet")).toBeInTheDocument();
  });
});

describe("View and Download — CertificatesPanel's rules", () => {
  it("web: a tap offers View (in place, ?view=1) and Download (a new tab)", async () => {
    renderAt();
    fireEvent.click(await screen.findByText("NIETE · Aspiring"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("NIETE-ASP-1")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /View/ }));
    expect(clicks.at(-1)).toEqual({ href: "/api/portal/training/certificates/NIETE-ASP-1/download?view=1", target: "" });
    fireEvent.click(within(sheet).getByRole("button", { name: /Download/ }));
    expect(clicks.at(-1)).toEqual({ href: "/api/portal/training/certificates/NIETE-ASP-1/download", target: "_blank" });
  });

  it("the app: a tap downloads in place (no View, no _blank), on the API's origin", async () => {
    runtime.native = true;
    renderAt();
    fireEvent.click(await screen.findByText("NIETE · Aspiring"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(clicks).toEqual([{ href: "https://portal-sandbox.up.railway.app/api/portal/training/certificates/NIETE-ASP-1/download", target: "" }]);
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words are labels", async () => {
    renderAt();
    await screen.findByText("NIETE · Aspiring");
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [role=radio]"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
    expect(CERTIFICATES).toHaveLength(4);
  });
});
