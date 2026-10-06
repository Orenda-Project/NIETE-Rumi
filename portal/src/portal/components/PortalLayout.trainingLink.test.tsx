import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Training on the web: a teacher who opened the link on the training template
// (WhatsApp's own browser) has a session scoped to training — /dashboard says
// so with sessionScope 'training'. The portal then shows training only: no
// navigation to pages the session cannot read, any other page goes to
// /portal/training, and a session that has run out goes back to the link page
// (/t, "open Training again in WhatsApp"), never to a password she may not have.
vi.mock("../services/api", () => ({
  portal: { getDashboard: vi.fn(), getConfig: vi.fn().mockResolvedValue({}) },
  auth: { logout: vi.fn() },
}));
import { portal } from "../services/api";
import PortalLayout from "./PortalLayout";

const api = portal as any;
const LINK_USER = { firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001", sessionScope: "training" };
const PASSWORD_USER = { firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001", sessionScope: null };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/training" element={<PortalLayout><div>training page</div></PortalLayout>} />
        <Route path="/portal/coaching" element={<PortalLayout><div>coaching page</div></PortalLayout>} />
        <Route path="/portal/login" element={<div>password login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

let replace: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  replace = vi.fn();
  vi.stubGlobal("location", { ...window.location, replace, href: "http://localhost/portal/training", pathname: "/portal/training" });
});
afterEach(() => vi.unstubAllGlobals());

describe("a session from the training link", () => {
  it("shows the training page with no navigation", async () => {
    api.getDashboard.mockResolvedValue({ user: LINK_USER });
    renderAt("/portal/training");
    await screen.findByText("training page");
    expect(screen.queryByText("Lesson Plans")).toBeNull();
    expect(screen.queryByText("Coaching")).toBeNull();
  });

  it("is sent to training from any other page", async () => {
    api.getDashboard.mockResolvedValue({ user: LINK_USER });
    renderAt("/portal/coaching");
    await screen.findByText("training page");
    expect(screen.queryByText("coaching page")).toBeNull();
  });

  it("goes back to the link page, not the password login, once it has run out", async () => {
    api.getDashboard.mockResolvedValueOnce({ user: LINK_USER });
    const first = renderAt("/portal/training");
    await screen.findByText("training page");
    first.unmount();

    api.getDashboard.mockRejectedValueOnce(Object.assign(new Error("401"), { response: { status: 401 } }));
    renderAt("/portal/training");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/t"));
    expect(screen.queryByText("password login")).toBeNull();
  });
});

describe("a password session is unchanged", () => {
  it("keeps the navigation and the page it asked for", async () => {
    api.getDashboard.mockResolvedValue({ user: PASSWORD_USER });
    renderAt("/portal/coaching");
    await screen.findByText("coaching page");
    expect(screen.getAllByText("Lesson Plans").length).toBeGreaterThan(0);
  });

  it("a password login after a link session forgets the link", async () => {
    api.getDashboard.mockResolvedValueOnce({ user: LINK_USER });
    const first = renderAt("/portal/training");
    await screen.findByText("training page");
    first.unmount();

    api.getDashboard.mockResolvedValueOnce({ user: PASSWORD_USER });
    const second = renderAt("/portal/coaching");
    await screen.findByText("coaching page");
    second.unmount();

    api.getDashboard.mockRejectedValueOnce(Object.assign(new Error("401"), { response: { status: 401 } }));
    renderAt("/portal/coaching");
    await screen.findByText("password login");
    expect(replace).not.toHaveBeenCalled();
  });
});
