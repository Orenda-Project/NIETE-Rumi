import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";

/**
 * bd-fxk3t8 — no full-screen spinner, and the menu never leaves the screen.
 *
 * Measured on sandbox: PortalLayout swapped the whole page for a centred spinner while
 * the user loaded (on EVERY page, because every page read the user again), so a tap on
 * the menu blanked the screen for ~1 s. Now:
 *  - while the user loads (the first page of a visit only), the layout draws the app's
 *    frame with placeholder blocks — the frame this device showed last (niete:shell);
 *  - under the app-level AuthProvider, the next page's FIRST render already has the menu;
 *  - while the menu's flags are read, placeholder bars hold its place (no old-menu flash);
 *  - once the frame is known, it is remembered for the next cold start (index.html reads it).
 */

vi.mock("../services/api", () => ({
  portal: { getDashboard: vi.fn(), getConfig: vi.fn() },
  auth: { logout: vi.fn() },
}));

import { portal } from "../services/api";
import PortalLayout from "./PortalLayout";
import { AuthProvider } from "../hooks/AuthProvider";
import { resetNewUiMemory } from "../lib/useNewUi";
import { resetTeacherV2Memory } from "../teacher/useTeacherV2";
import { resetCoachV2Memory } from "../coach/useCoachV2";

const api = portal as unknown as { getDashboard: ReturnType<typeof vi.fn>; getConfig: ReturnType<typeof vi.fn> };

async function settle() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
}

const spinner = (c: HTMLElement) => c.querySelector(".animate-spin");
const TEACHER = { firstName: "Ayesha", role: "teacher", phoneNumber: "923001110001" };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetNewUiMemory();
  resetTeacherV2Memory();
  resetCoachV2Memory();
});

describe("PortalLayout while the user loads", () => {
  it("draws the frame with placeholder blocks, never a spinner", () => {
    api.getDashboard.mockImplementation(() => new Promise(() => {}));
    const { container } = render(
      <MemoryRouter><PortalLayout><p>page</p></PortalLayout></MemoryRouter>,
    );
    expect(spinner(container)).toBeNull();
    expect(screen.queryByText("Loading...")).toBeNull();
    const frame = container.querySelector("[data-frame]")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(3);
  });

  it("the frame is the one this device showed last", () => {
    api.getDashboard.mockImplementation(() => new Promise(() => {}));
    window.localStorage.setItem("niete:shell", "teacher");
    const { container } = render(<MemoryRouter><PortalLayout><p>page</p></PortalLayout></MemoryRouter>);
    expect(container.querySelector("[data-frame]")!.getAttribute("data-frame")).toBe("teacher");
  });

  it("no hint: the classic frame", () => {
    api.getDashboard.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<MemoryRouter><PortalLayout><p>page</p></PortalLayout></MemoryRouter>);
    expect(container.querySelector("[data-frame]")!.getAttribute("data-frame")).toBe("classic");
  });

  it("a page's own loadingFallback still fills the frame", () => {
    api.getDashboard.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><PortalLayout loadingFallback={<p>my skeleton</p>}><p>page</p></PortalLayout></MemoryRouter>);
    expect(screen.getByText("my skeleton")).toBeTruthy();
  });
});

describe("PortalLayout between pages (app-level user)", () => {
  function Page({ name, to }: { name: string; to: string }) {
    return <PortalLayout><p>{name}</p><Link to={to}>go</Link></PortalLayout>;
  }

  it("the next page's first render has the menu and its content — no frame placeholder, no spinner", async () => {
    api.getDashboard.mockResolvedValue({ user: TEACHER });
    api.getConfig.mockResolvedValue({ success: true, features: { teacherV2: true } });
    const { container } = render(
      <MemoryRouter initialEntries={["/one"]}>
        <AuthProvider>
          <Routes>
            <Route path="/one" element={<Page name="page one" to="/two" />} />
            <Route path="/two" element={<Page name="page two" to="/one" />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await settle();
    expect(screen.getByTestId("teacher-nav")).toBeTruthy();

    fireEvent.click(screen.getByText("go"));
    // synchronously after the click: the new page, its menu, nothing placeholder
    expect(screen.getByText("page two")).toBeTruthy();
    expect(screen.getByTestId("teacher-nav")).toBeTruthy();
    expect(container.querySelector("[data-frame]")).toBeNull();
    expect(spinner(container)).toBeNull();
    await settle();
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
  });
});

describe("PortalLayout while the menu's flags are read", () => {
  it("placeholder bars hold the menu's place; the page itself renders", async () => {
    api.getDashboard.mockResolvedValue({ user: TEACHER });
    api.getConfig.mockImplementation(() => new Promise(() => {}));
    window.localStorage.setItem("niete:shell", "teacher");
    const { container } = render(<MemoryRouter><PortalLayout><p>page</p></PortalLayout></MemoryRouter>);
    await settle();
    expect(screen.getByText("page")).toBeTruthy();
    expect(container.querySelector("[data-nav-placeholder]")).not.toBeNull();
    // neither menu yet: not the classic one (the flash), not v2
    expect(screen.queryByText("Lesson Plans")).toBeNull();
    expect(screen.queryByTestId("teacher-nav")).toBeNull();
  });
});

describe("PortalLayout remembers the frame for the next cold start", () => {
  it("a v2 teacher: teacher", async () => {
    api.getDashboard.mockResolvedValue({ user: TEACHER });
    api.getConfig.mockResolvedValue({ success: true, features: { teacherV2: true } });
    render(<MemoryRouter><PortalLayout><p>page</p></PortalLayout></MemoryRouter>);
    await settle();
    expect(window.localStorage.getItem("niete:shell")).toBe("teacher");
  });

  it("anyone else: classic", async () => {
    api.getDashboard.mockResolvedValue({ user: TEACHER });
    api.getConfig.mockResolvedValue({ success: true, features: { teacherV2: false } });
    window.localStorage.setItem("niete:shell", "teacher");
    render(<MemoryRouter><PortalLayout><p>page</p></PortalLayout></MemoryRouter>);
    await settle();
    expect(window.localStorage.getItem("niete:shell")).toBe("classic");
  });
});
