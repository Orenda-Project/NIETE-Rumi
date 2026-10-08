import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-fxk3t8 — "/" (every Android app launch) is never a white screen.
 *
 * PortalRoot rendered nothing while it asked whether there is a session, so the app's
 * cold start was white until /dashboard answered. It now draws an outline: the app frame
 * on a device that was signed in last time (niete:shell), the sign-in card otherwise.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalRoot from "./PortalRoot";

function boot(hint: string | null) {
  window.localStorage.clear();
  if (hint) window.localStorage.setItem("niete:shell", hint);
  vi.mocked(useAuth).mockReturnValue({ user: null, loading: true } as unknown as ReturnType<typeof useAuth>);
  return render(<MemoryRouter initialEntries={["/"]}><PortalRoot /></MemoryRouter>);
}

describe("PortalRoot while the session is checked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signed in last time: the app's frame", () => {
    const { container } = boot("teacher");
    expect(container.querySelector('[data-frame="teacher"]')).not.toBeNull();
  });

  it("no hint: the sign-in outline", () => {
    const { container } = boot(null);
    expect(container.querySelector('[data-frame="login"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(2);
  });
});
