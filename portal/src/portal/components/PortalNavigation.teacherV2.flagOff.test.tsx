import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-fmf24g.1 — the teacher app v2 ships behind `portal_teacher_v2`, for teachers
 * only. With the flag OFF (false, absent, /config loading, /config failing), or
 * ON for anyone in the leader family, the navigation must be exactly what it was.
 *
 * The snapshots in __snapshots__/ were recorded against the navigation BEFORE
 * teacher v2 existed — both today's classic menu and the new UI's (portal_new_ui)
 * menu, since the pilot teachers have the new UI on. Radix sheet ids are
 * normalised; every other character is compared as is.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalNavigation from "./PortalNavigation";
import { resetNewUiMemory } from "../lib/useNewUi";

type ConfigMode = "off" | "absent" | "loading" | "fails" | "on";

function setConfig(mode: ConfigMode, newUi: boolean) {
  const fn = vi.mocked(portal.getConfig);
  fn.mockReset();
  const base = { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi, coachV2: false };
  if (mode === "off") fn.mockResolvedValue({ success: true, features: { ...base, teacherV2: false } } as never);
  if (mode === "absent") fn.mockResolvedValue({ success: true, features: base } as never);
  if (mode === "on") fn.mockResolvedValue({ success: true, features: { ...base, teacherV2: true } } as never);
  if (mode === "loading") fn.mockImplementation(() => new Promise(() => {}));
  if (mode === "fails") fn.mockRejectedValue(new Error("network"));
}

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderNav(user: Record<string, unknown>, path: string, mode: ConfigMode, newUi = false) {
  resetNewUiMemory();
  // The remembered teacher-v2 answer must not leak between renders either.
  try {
    const mod = await import("../teacher/useTeacherV2");
    mod.resetTeacherV2Memory();
  } catch { /* before teacher v2 existed there is nothing to reset */ }
  setConfig(mode, newUi);
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <PortalNavigation />
    </MemoryRouter>,
  );
  await settle();
  const closed = normalise(container.innerHTML);
  // The classic menu's More sheet is part of the markup to pin; the new UI's
  // pull-up menu is covered by its own tests (the closed bar is pinned here).
  let open = "";
  if (!newUi) {
    await userEvent.setup().click(screen.getByTestId("mobile-nav-more"));
    const sheet = await screen.findByRole("dialog");
    await settle();
    open = normalise(sheet.outerHTML);
  }
  cleanup();
  return { closed, open };
}

const TEACHER = { id: "t-1", firstName: "Ayesha", lastName: "Bibi", role: "teacher", phoneNumber: "923001110001" };

describe("bd-fmf24g.1 — teacher v2 off: the navigation is exactly what it was", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["classic menu", false],
    ["new UI menu", true],
  ])("teacher on Home, %s", async (_label, newUi) => {
    const off = await renderNav(TEACHER, "/portal/dashboard", "off", newUi);
    expect(off.closed).toMatchSnapshot("nav");
    expect(off.open).toMatchSnapshot("sheet");
    // While /config loads or fails the new UI cannot be on either, so the new-UI
    // menu is compared only against an answer that carries no teacherV2 at all.
    const modes = newUi ? (["absent"] as const) : (["absent", "loading", "fails"] as const);
    for (const mode of modes) {
      const other = await renderNav(TEACHER, "/portal/dashboard", mode, newUi);
      expect(other.closed, `nav while /config is ${mode}`).toBe(off.closed);
      expect(other.open, `sheet while /config is ${mode}`).toBe(off.open);
    }
  });

  it.each([
    ["coach", { id: "c-1", firstName: "Noor", role: "coach", phoneNumber: "923001110004" }, "/portal/leader"],
  ])("flag ON for a %s: unchanged — the coach has her own app, never the teacher's", async (_label, user, path) => {
    const off = await renderNav(user, path, "off");
    const on = await renderNav(user, path, "on");
    expect(on.closed).toBe(off.closed);
    expect(on.open).toBe(off.open);
  });
});
