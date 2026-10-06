import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-o15qnr — the coach app v2 ships behind `portal_coach_v2`, and only for
 * role=coach. With the flag OFF, or for anyone who is not a coach, the
 * navigation must be exactly what it was.
 *
 * The snapshot in __snapshots__/ was recorded against the navigation BEFORE
 * coach v2 existed. Every off state (false, absent, /config loading, /config
 * failing) for a coach, and the flag ON for a teacher and a principal, must
 * render that same markup. Radix sheet ids are normalised; every other
 * character is compared as is.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalNavigation from "./PortalNavigation";
import { resetNewUiMemory } from "../lib/useNewUi";

type ConfigMode = "off" | "absent" | "loading" | "fails" | "on";

function setConfig(mode: ConfigMode) {
  const fn = vi.mocked(portal.getConfig);
  fn.mockReset();
  const base = { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: false };
  if (mode === "off") fn.mockResolvedValue({ success: true, features: { ...base, coachV2: false } } as never);
  if (mode === "absent") fn.mockResolvedValue({ success: true, features: base } as never);
  if (mode === "on") fn.mockResolvedValue({ success: true, features: { ...base, coachV2: true } } as never);
  if (mode === "loading") fn.mockImplementation(() => new Promise(() => {}));
  if (mode === "fails") fn.mockRejectedValue(new Error("network"));
}

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderNav(user: Record<string, unknown>, path: string, mode: ConfigMode) {
  resetNewUiMemory();
  setConfig(mode);
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <PortalNavigation />
    </MemoryRouter>,
  );
  await settle();
  const closed = normalise(container.innerHTML);
  await userEvent.setup().click(screen.getByTestId("mobile-nav-more"));
  const sheet = await screen.findByRole("dialog");
  await settle();
  const open = normalise(sheet.outerHTML);
  cleanup();
  return { closed, open };
}

const COACH = { id: "c-1", firstName: "Noor", role: "coach", phoneNumber: "923001234567" };

describe("bd-o15qnr — coach v2 off: the navigation is exactly what it was", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["coach on My Patch", "/portal/leader"],
    ["coach on Observations", "/portal/leader/observations"],
  ])("%s", async (_label, path) => {
    const off = await renderNav(COACH, path, "off");
    expect(off.closed).toMatchSnapshot("nav");
    expect(off.open).toMatchSnapshot("sheet");
    for (const mode of ["absent", "loading", "fails"] as const) {
      const other = await renderNav(COACH, path, mode);
      expect(other.closed, `nav while /config is ${mode}`).toBe(off.closed);
      expect(other.open, `sheet while /config is ${mode}`).toBe(off.open);
    }
  });

  it.each([
    ["teacher", { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001110001" }, "/portal/dashboard"],
    ["principal", { id: "p-1", firstName: "Sana", role: "principal", phoneNumber: "923001110002" }, "/portal/leader"],
    ["aeo", { id: "a-1", firstName: "Imran", role: "aeo", phoneNumber: "923001110003" }, "/portal/leader"],
  ])("flag ON for a %s: unchanged — v2 is for coaches only", async (_label, user, path) => {
    const off = await renderNav(user, path, "off");
    const on = await renderNav(user, path, "on");
    expect(on.closed).toBe(off.closed);
    expect(on.open).toBe(off.open);
    expect(off.closed).toMatchSnapshot("nav");
  });
});
