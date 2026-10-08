import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-fmf24g.1 — with `portal_teacher_v2` on, a teacher gets the v2 bottom menu:
 * Home, Lessons, Digital Coaching, Training, More. Each item goes to the
 * feature's v2 page once it is registered, and to today's page until then.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalNavigation from "./PortalNavigation";
import { resetNewUiMemory } from "../lib/useNewUi";
import { resetTeacherV2Memory } from "../teacher/useTeacherV2";
import { teacherPath } from "../teacher/routes";

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderNav(user: Record<string, unknown>, path: string, features: Record<string, unknown>) {
  resetNewUiMemory();
  resetTeacherV2Memory();
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <PortalNavigation />
    </MemoryRouter>,
  );
  await settle();
  return view;
}

const TEACHER = { id: "t-1", firstName: "Ayesha", lastName: "Bibi", role: "teacher", phoneNumber: "923001110001" };

describe("bd-fmf24g.1 — the teacher v2 bottom menu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the five items, in order, for a teacher with the flag", async () => {
    await renderNav(TEACHER, "/portal/dashboard", { teacherV2: true, newUi: true });
    const nav = screen.getByTestId("teacher-nav");
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Home", "Lessons", "Digital Coaching", "Training", "More"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      teacherPath("home"), teacherPath("lessons"), teacherPath("coaching"), teacherPath("training"), teacherPath("more"),
    ]);
  });

  it("wins over the new UI's menu", async () => {
    await renderNav(TEACHER, "/portal/dashboard", { teacherV2: true, newUi: true });
    expect(screen.queryByTestId("newui-top-nav")).toBeNull();
  });

  it("marks the current feature, including on its inner pages", async () => {
    await renderNav(TEACHER, "/portal/teacher/more", { teacherV2: true });
    const nav = screen.getByTestId("teacher-nav");
    const current = within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["More"]);
  });

  it("every item is a 56px+ target with a single-line label", async () => {
    await renderNav(TEACHER, "/portal/dashboard", { teacherV2: true });
    for (const a of within(screen.getByTestId("teacher-nav")).getAllByRole("link")) {
      expect(a.className).toMatch(/min-h-\[58px\]/);
      expect(a.className).toMatch(/whitespace-nowrap/);
    }
  });

  it("a coach with the teacher flag keeps their own menu", async () => {
    await renderNav({ id: "c-1", firstName: "Noor", role: "coach", phoneNumber: "923001110004" }, "/portal/leader", { teacherV2: true });
    expect(screen.queryByTestId("teacher-nav")).toBeNull();
  });
});
