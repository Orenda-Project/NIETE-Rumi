import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { BANDS_STATE, httpError, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — My grades (deep-screens.html, Training 10), BandPicker in the kit: a ToggleList
 * (Primary 1–5, Middle 6–8, High 9–10, any number), an amber lock chip "Locked 48h after save",
 * and Save. The 48-hour rule is the server's: it sends `can_change` and `hours_remaining`, and a
 * save inside the window is refused with 429 — which becomes the chip ("Locked · 31h"), never a
 * sentence. The server's own notice sentences are not shown.
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

import { useAuth } from "../../hooks/useAuth";
import api, { portal } from "../../services/api";
import PortalTrainingPage from "../../pages/PortalTrainingPage";
import { TRAINING_ROUTES } from "../../lib/trainingRoutes";

function renderAt(path = "/portal/training/grades") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />)}
      </Routes>
    </MemoryRouter>,
  );
}

let bands: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  bands = { ...BANDS_STATE };
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(trainingGet({ "/training/bands": () => bands }) as never);
});

const toggles = () => within(screen.getByRole("group", { name: "Grades" })).getAllByRole("checkbox");

describe("My grades", () => {
  it("the light bar, title 'My grades'; three toggles with their grade chips; her choice on", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { level: 1, name: "My grades" })).toBeInTheDocument();
    await screen.findByText("Primary");
    const t = toggles();
    expect(t.map((b) => b.textContent)).toEqual(["Primary1–5", "Middle6–8", "High9–10"]);
    expect(t.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("an amber lock chip 'Locked 48h after save' — not the server's sentence", async () => {
    renderAt();
    const chip = (await screen.findByText("Locked 48h after save")).closest("[data-chip]");
    expect(chip?.className).toContain("bg-nu-chip-warning-bg");
    expect(screen.queryByText(/cannot be changed again/)).not.toBeInTheDocument();
  });

  it("Save posts the bands, as BandPicker did", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, unchanged: false, programs: [] } } as never);
    renderAt();
    await screen.findByText("Primary");
    fireEvent.click(toggles()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/bands", { bands: ["PRIMARY", "MIDDLE"] }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("nothing picked: Save waits", async () => {
    renderAt();
    await screen.findByText("Primary");
    fireEvent.click(toggles()[0]);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("inside the 48 hours: 'Locked · 31h', the toggles and Save off", async () => {
    bands = { ...BANDS_STATE, can_change: false, hours_remaining: 31, notice: "You changed the grades you teach less than 48 hours ago." };
    renderAt();
    expect(await screen.findByText("Locked · 31h")).toBeInTheDocument();
    expect(toggles().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByText(/less than 48 hours/)).not.toBeInTheDocument();
  });

  it("a 429 becomes the chip state, with the hours the server now reports", async () => {
    vi.mocked(api.post).mockImplementation((async () => {
      bands = { ...BANDS_STATE, can_change: false, hours_remaining: 47 };
      throw httpError(429, { reason: "cooldown", error: "You changed the grades you teach less than 48 hours ago." });
    }) as never);
    renderAt();
    await screen.findByText("Primary");
    fireEvent.click(toggles()[2]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Locked · 47h")).toBeInTheDocument();
    expect(screen.queryByText(/less than 48 hours/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("any other refusal: 'Not saved'", async () => {
    vi.mocked(api.post).mockRejectedValue(httpError(400, { reason: "empty" }));
    renderAt();
    await screen.findByText("Primary");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words are labels", async () => {
    renderAt();
    await screen.findByText("Primary");
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
