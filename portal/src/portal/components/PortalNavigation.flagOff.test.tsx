import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-5rz1v.12 — the new UI ships behind `portal_new_ui`, and with the flag OFF
 * nothing may change for anyone.
 *
 * The snapshot in __snapshots__/ was recorded against the navigation as it was
 * BEFORE the flag existed. Every flag-off state must render that same markup:
 * the flag false, the flag absent from /config, /config still loading, and
 * /config failing. A difference of one class name fails this test.
 *
 * Radix gives the sheet generated ids (`radix-:r3:`) that depend on how many
 * components mounted before it in the test file, so those are normalised; every
 * other character is compared as is.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalNavigation from "./PortalNavigation";

type ConfigMode = "off" | "absent" | "loading" | "fails";

function setConfig(mode: ConfigMode) {
  const fn = vi.mocked(portal.getConfig);
  fn.mockReset();
  if (mode === "off") fn.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: false } } as never);
  if (mode === "absent") fn.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null } } as never);
  if (mode === "loading") fn.mockImplementation(() => new Promise(() => {}));
  if (mode === "fails") fn.mockRejectedValue(new Error("network"));
}

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

/** The nav's markup, then the same with the More/Other sheet open. */
async function renderNav(user: Record<string, unknown>, path: string, mode: ConfigMode) {
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

const CASES: Array<[string, Record<string, unknown>, string]> = [
  ["teacher on Dashboard", { id: "t-1", firstName: "Ayesha", role: "teacher" }, "/portal/dashboard"],
  ["teacher on My Classes (an overflow item)", { id: "t-1", firstName: "Ayesha", role: "teacher" }, "/portal/classes"],
  ["teacher on My account", { id: "t-1", firstName: "Ayesha", role: "teacher" }, "/portal/account"],
  ["coach on My Patch", { id: "c-1", firstName: "Noor", role: "coach" }, "/portal/leader"],
  ["principal on Analytics", { id: "p-1", firstName: "Sana", role: "principal" }, "/portal/leader/school-analytics"],
];

describe("bd-5rz1v.12 — flag off: the navigation is exactly what it was", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(CASES)("%s", async (_label, user, path) => {
    const off = await renderNav(user, path, "off");
    expect(off.closed).toMatchSnapshot("nav");
    expect(off.open).toMatchSnapshot("sheet");

    for (const mode of ["absent", "loading", "fails"] as const) {
      const other = await renderNav(user, path, mode);
      expect(other.closed, `nav while /config is ${mode}`).toBe(off.closed);
      expect(other.open, `sheet while /config is ${mode}`).toBe(off.open);
    }
  });
});
