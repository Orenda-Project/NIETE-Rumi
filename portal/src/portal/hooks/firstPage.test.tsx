import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fxk3t8 — the first page of a visit, measured after parts 1–3 on sandbox:
 *   GET /dashboard (0.9–1.2 s: her user AND four counts) → only then GET /config → page,
 *   and /config asked again by every hook that mounted afterwards.
 * Now:
 *   - who she is comes from GET /me (the same user, no counts; /dashboard if the server
 *     has no /me yet);
 *   - /config is read alongside it, not after it, and an answer is reused for 30 s;
 *     signing in or out forgets it (the flags are per user);
 *   - the sign-in page and today's Home never draw white or the wrong page while they wait.
 */

vi.mock("../services/api", () => ({
  portal: { getMe: vi.fn(), getDashboard: vi.fn(), getConfig: vi.fn(), getCoachingAnalytics: vi.fn() },
  auth: { login: vi.fn(), logout: vi.fn() },
}));

import { portal, auth } from "../services/api";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./useAuth";
import { readConfigShared, resetNewUiMemory } from "../lib/useNewUi";
import { resetTeacherV2Memory } from "../teacher/useTeacherV2";
import PortalLogin from "../pages/PortalLogin";
import PortalDashboard from "../pages/PortalDashboard";

const api = portal as unknown as Record<string, ReturnType<typeof vi.fn>>;
const never = () => new Promise(() => {});

async function settle() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
}

function Who() {
  const { user, loading, login } = useAuth();
  return (
    <div>
      <p>{loading ? "loading" : user ? `hi ${user.firstName}` : "nobody"}</p>
      <button onClick={() => login("03001234567", "pw")}>sign in</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetNewUiMemory();
  resetTeacherV2Memory();
});

describe("who she is", () => {
  it("comes from /me, not /dashboard", async () => {
    api.getMe.mockResolvedValue({ success: true, user: { firstName: "Ayesha" } });
    api.getConfig.mockResolvedValue({ success: true, features: {} });
    render(<MemoryRouter><AuthProvider><Who /></AuthProvider></MemoryRouter>);
    await settle();
    expect(screen.getByText("hi Ayesha")).toBeTruthy();
    expect(api.getDashboard).not.toHaveBeenCalled();
  });

  it("a server without /me yet (404): /dashboard, as before", async () => {
    api.getMe.mockRejectedValue({ response: { status: 404 } });
    api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha" } });
    api.getConfig.mockResolvedValue({ success: true, features: {} });
    render(<MemoryRouter><AuthProvider><Who /></AuthProvider></MemoryRouter>);
    await settle();
    expect(screen.getByText("hi Ayesha")).toBeTruthy();
  });

  it("signed out (401): nobody — no second try", async () => {
    api.getMe.mockRejectedValue({ response: { status: 401 } });
    api.getConfig.mockResolvedValue({ success: true, features: {} });
    render(<MemoryRouter><AuthProvider><Who /></AuthProvider></MemoryRouter>);
    await settle();
    expect(screen.getByText("nobody")).toBeTruthy();
    expect(api.getDashboard).not.toHaveBeenCalled();
  });
});

describe("/config", () => {
  it("is read alongside who she is, not after", async () => {
    api.getMe.mockImplementation(never);
    api.getConfig.mockImplementation(never);
    render(<MemoryRouter><AuthProvider><Who /></AuthProvider></MemoryRouter>);
    await settle();
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.getConfig).toHaveBeenCalledTimes(1);
  });

  it("an answer is reused for 30 s, then read again", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    api.getConfig.mockResolvedValue({ success: true, features: { teacherV2: true } });
    await readConfigShared();
    await readConfigShared();
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    now += 31_000;
    await readConfigShared();
    expect(api.getConfig).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("a failed read is not kept", async () => {
    api.getConfig.mockRejectedValueOnce(new Error("down")).mockResolvedValue({ success: true, features: {} });
    expect(await readConfigShared()).toBeNull();
    expect(await readConfigShared()).not.toBeNull();
    expect(api.getConfig).toHaveBeenCalledTimes(2);
  });

  it("signing in forgets it: the flags are per user", async () => {
    api.getMe.mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValue({ success: true, user: { firstName: "Ayesha" } });
    api.getConfig.mockResolvedValue({ success: true, features: {} });
    vi.mocked(auth.login).mockResolvedValue({ success: true, user: { firstName: "Ayesha" } } as never);
    render(<MemoryRouter><AuthProvider><Who /></AuthProvider></MemoryRouter>);
    await settle();
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    await act(async () => { screen.getByText("sign in").click(); });
    await settle();
    await readConfigShared();
    expect(api.getConfig).toHaveBeenCalledTimes(2);
  });
});

describe("pages that wait", () => {
  it("the sign-in page while the session is checked: an outline, never white", () => {
    api.getMe.mockImplementation(never);
    api.getConfig.mockImplementation(never);
    const { container } = render(<MemoryRouter><AuthProvider><PortalLogin /></AuthProvider></MemoryRouter>);
    expect(container.querySelector("[data-frame]")).not.toBeNull();
  });

  it("today's Home on a v2 device while she loads: the v2 frame, and the old dashboard never starts", async () => {
    window.localStorage.setItem("niete:shell", "teacher");
    api.getMe.mockImplementation(never);
    api.getConfig.mockImplementation(never);
    const { container } = render(
      <MemoryRouter initialEntries={["/portal/dashboard"]}>
        <AuthProvider>
          <Routes><Route path="/portal/dashboard" element={<PortalDashboard />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await settle();
    expect(container.querySelector('[data-frame="teacher"]')).not.toBeNull();
    expect(api.getDashboard).not.toHaveBeenCalled(); // the old dashboard's counts
  });
});
