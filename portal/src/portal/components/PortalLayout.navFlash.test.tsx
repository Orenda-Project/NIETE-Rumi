import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-5rz1v.6.6 — a coach saw the TEACHER bottom navigation (Dashboard /
// Curriculum / Training / Coaching) for a moment on every coach page, then the
// leader one. PortalNavigation called useAuth() itself: a second, independent
// fetch of /dashboard that starts with no user, and isLeader(null) is false —
// so until that second fetch returned, a leader got the teacher nav (and every
// page load fetched /dashboard twice, which the portal's request log shows).
// The layout already holds the loaded user; the navigation uses it.

vi.mock("../services/api", () => ({
  portal: { getDashboard: vi.fn() },
  auth: { logout: vi.fn() },
}));

import { portal } from "../services/api";
import PortalLayout from "./PortalLayout";

const api = portal as any;

beforeEach(() => vi.clearAllMocks());

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/portal/leader/observations"]}>
      <PortalLayout><div>page</div></PortalLayout>
    </MemoryRouter>,
  );
}

describe("PortalLayout navigation", () => {
  it("a coach never sees the teacher navigation, and /dashboard is read once", async () => {
    // The layout's read answers; any second read never does — exactly the window the flash lived in.
    api.getDashboard
      .mockResolvedValueOnce({ user: { firstName: "Hataf", role: "coach" } })
      .mockImplementation(() => new Promise(() => {}));
    renderLayout();
    await screen.findByText("page");
    await waitFor(() => expect(screen.getAllByText("Observations").length).toBeGreaterThan(0));
    expect(screen.queryByText("Curriculum")).toBeNull();
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
  });

  it("a teacher still gets the teacher navigation", async () => {
    api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha", role: "teacher" } });
    renderLayout();
    await screen.findByText("page");
    expect(screen.getAllByText("Curriculum").length).toBeGreaterThan(0);
    expect(screen.queryByText("My Patch")).toBeNull();
  });
});
