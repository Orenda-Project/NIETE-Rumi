import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";

/**
 * bd-fxk3t8 — the signed-in user is read ONCE per visit, at the app's root, and kept.
 *
 * Measured on sandbox: every page asked GET /dashboard again (twice, 0.9–1.9 s each) and
 * showed a full-screen spinner until it answered, so every tap on the menu blanked the
 * screen. The answer now lives above the routes: the first page that needs it reads it,
 * every page after that has it at once. Pages that never ask (sign-in, privacy) read nothing.
 * After 30 s a page asks again in the background, so an edit made elsewhere still shows —
 * without the spinner.
 */

vi.mock("../services/api", () => ({
  portal: { getDashboard: vi.fn() },
  auth: { logout: vi.fn(), login: vi.fn() },
}));

import { portal, auth } from "../services/api";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./useAuth";

const api = portal as unknown as { getDashboard: ReturnType<typeof vi.fn> };

function Page({ name }: { name: string }) {
  const { user, loading, logout } = useAuth();
  return (
    <div>
      <p>{name}: {loading ? "loading" : user ? `hi ${user.firstName}` : "nobody"}</p>
      <Link to="/a">to a</Link>
      <Link to="/b">to b</Link>
      <Link to="/public">to public</Link>
      <button onClick={() => logout()}>log out</button>
    </div>
  );
}

function PublicPage() {
  return <div><p>public page</p><Link to="/a">to a</Link></div>;
}

function app(start = "/a") {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <AuthProvider>
        <Routes>
          <Route path="/a" element={<Page name="a" />} />
          <Route path="/b" element={<Page name="b" />} />
          <Route path="/public" element={<PublicPage />} />
          <Route path="/portal/login" element={<p>login page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("AuthProvider — one read of the signed-in user per visit", () => {
  it("the next page has her at once: no loading, no second read", async () => {
    api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha", role: "teacher" } });
    app();
    expect(screen.getByText("a: loading")).toBeTruthy();
    await settle();
    expect(screen.getByText("a: hi Ayesha")).toBeTruthy();

    fireEvent.click(screen.getByText("to b"));
    // the very first render of the new page already has her
    expect(screen.getByText("b: hi Ayesha")).toBeTruthy();
    await settle();
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
  });

  it("a page that never asks reads nothing (sign-in and public pages stay as they are)", async () => {
    api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha" } });
    app("/public");
    await settle();
    expect(screen.getByText("public page")).toBeTruthy();
    expect(api.getDashboard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("to a"));
    await settle();
    expect(screen.getByText("a: hi Ayesha")).toBeTruthy();
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
  });

  it("after 30 s the next page re-reads in the background, never showing loading", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    api.getDashboard.mockResolvedValueOnce({ user: { firstName: "Ayesha" } });
    app();
    await settle();

    let answer: (v: unknown) => void = () => {};
    api.getDashboard.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    now += 31_000;
    fireEvent.click(screen.getByText("to b"));
    await settle();
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    expect(screen.getByText("b: hi Ayesha")).toBeTruthy(); // still her, not "loading"

    await act(async () => { answer({ user: { firstName: "Ayesha B." } }); });
    expect(screen.getByText("b: hi Ayesha B.")).toBeTruthy();
    spy.mockRestore();
  });

  it("a failed background re-read keeps her (no sign-out on a network blip)", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    api.getDashboard.mockResolvedValueOnce({ user: { firstName: "Ayesha" } });
    app();
    await settle();
    api.getDashboard.mockRejectedValueOnce(new Error("network"));
    now += 31_000;
    fireEvent.click(screen.getByText("to b"));
    await settle();
    expect(screen.getByText("b: hi Ayesha")).toBeTruthy();
    spy.mockRestore();
  });

  it("logging out forgets her and the frame this device showed", async () => {
    api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha" } });
    vi.mocked(auth.logout).mockResolvedValue({} as never);
    window.localStorage.setItem("niete:shell", "teacher");
    app();
    await settle();
    fireEvent.click(screen.getByText("log out"));
    await settle();
    expect(screen.getByText("login page")).toBeTruthy();
    expect(window.localStorage.getItem("niete:shell")).toBeNull();
  });

  it("no session: the frame hint is cleared, so the next cold start shows the sign-in outline", async () => {
    api.getDashboard.mockRejectedValue({ response: { status: 401 } });
    window.localStorage.setItem("niete:shell", "teacher");
    app();
    await settle();
    expect(screen.getByText("a: nobody")).toBeTruthy();
    expect(window.localStorage.getItem("niete:shell")).toBeNull();
  });
});
