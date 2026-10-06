import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Lesson plans on the web: a teacher who opened the link on the lesson-plans
// template (WhatsApp's own browser) has a session scoped to lesson plans —
// /dashboard says so with sessionScope 'lessons'. The portal then shows lesson
// plans only: no navigation, and any other page, training included, goes to
// /portal/curriculum. A training session is still kept to training.
vi.mock("../services/api", () => ({
  portal: { getDashboard: vi.fn() },
  auth: { logout: vi.fn() },
}));
import { portal } from "../services/api";
import PortalLayout from "./PortalLayout";

const api = portal as any;
const user = (sessionScope: string | null) => ({ firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001", sessionScope });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/curriculum" element={<PortalLayout><div>lesson plans page</div></PortalLayout>} />
        <Route path="/portal/training" element={<PortalLayout><div>training page</div></PortalLayout>} />
        <Route path="/portal/coaching" element={<PortalLayout><div>coaching page</div></PortalLayout>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("location", { ...window.location, replace: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("a session from the lesson-plans link", () => {
  it("shows lesson plans with no navigation", async () => {
    api.getDashboard.mockResolvedValue({ user: user("lessons") });
    renderAt("/portal/curriculum");
    await screen.findByText("lesson plans page");
    expect(screen.queryByText("Lesson Plans")).toBeNull();
    expect(screen.queryByText("Coaching")).toBeNull();
  });

  it.each(["/portal/training", "/portal/coaching"])("is sent to lesson plans from %s", async (path) => {
    api.getDashboard.mockResolvedValue({ user: user("lessons") });
    renderAt(path);
    await screen.findByText("lesson plans page");
  });
});

describe("a session from the training link", () => {
  it("is sent to training from lesson plans", async () => {
    api.getDashboard.mockResolvedValue({ user: user("training") });
    renderAt("/portal/curriculum");
    await screen.findByText("training page");
    expect(screen.queryByText("lesson plans page")).toBeNull();
  });
});

describe("a session with an area this app does not know", () => {
  it("shows nothing outside its area: it is sent to the link page", async () => {
    api.getDashboard.mockResolvedValue({ user: user("coaching") });
    renderAt("/portal/coaching");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("coaching page")).toBeNull();
    expect((window.location.replace as any)).toHaveBeenCalledWith("/t");
  });
});
