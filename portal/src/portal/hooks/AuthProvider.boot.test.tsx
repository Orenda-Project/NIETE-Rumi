/**
 * bd-sex15q.34 — on a coach's (or an RM's) first open of the insight pages, the signed-in user is asked for as soon
 * as the app draws its first frame, not after the page's chunks arrive and its gate asks.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const { getMe, getConfig } = vi.hoisted(() => ({
  getMe: vi.fn(() => new Promise(() => {})),
  getConfig: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/portal/services/api", async (orig) => {
  const real = await orig<typeof import("@/portal/services/api")>();
  return { ...real, portal: { ...real.portal, getMe, getConfig, getDashboard: vi.fn(() => new Promise(() => {})) } };
});

import { AuthProvider } from "./AuthProvider";

function boot(path: string) {
  window.history.pushState({}, "", path);
  return render(<MemoryRouter><AuthProvider><p>frame</p></AuthProvider></MemoryRouter>);
}

describe("AuthProvider at boot (bd-sex15q.34)", () => {
  beforeEach(() => { getMe.mockClear(); });

  it("a coach's insight page: /me is asked for with the first frame, before any page asks", () => {
    boot("/portal/coach/insights");
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("an RM's page: the same", () => {
    boot("/portal/rm");
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("any other page waits for a page to ask, as before", () => {
    for (const path of ["/portal/login", "/portal/privacy", "/", "/portal/coach"]) {
      getMe.mockClear();
      const r = boot(path);
      expect(getMe).not.toHaveBeenCalled();
      r.unmount();
    }
  });
});
