import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fxk3t8 — a v2 teacher signing in no longer sees the OLD dashboard first.
 *
 * Measured on sandbox: /portal/dashboard drew today's dashboard, then — once /config said
 * teacherV2 — swapped to the v2 Home (old dashboard → white → spinner → v2). On a device
 * that last showed the v2 frame (niete:shell = teacher), the dashboard now holds a
 * placeholder frame until the flag is known. Anywhere else nothing changes: today's
 * dashboard draws at once, as before.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn(), getDashboard: vi.fn(() => new Promise(() => {})), getCoachingAnalytics: vi.fn() } }));
vi.mock("../newui/home/NewHome", () => ({ default: () => <p>new ui home</p> }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalDashboard from "./PortalDashboard";
import { resetNewUiMemory } from "../lib/useNewUi";
import { resetTeacherV2Memory } from "../teacher/useTeacherV2";

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

const TEACHER = { firstName: "Ayesha", role: "teacher", phoneNumber: "923001110001" };

async function land(hint: string | null) {
  resetNewUiMemory();
  resetTeacherV2Memory();
  window.localStorage.clear();
  if (hint) window.localStorage.setItem("niete:shell", hint);
  vi.mocked(portal.getConfig).mockImplementation(() => new Promise(() => {}));
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false } as unknown as ReturnType<typeof useAuth>);
  const r = render(
    <MemoryRouter initialEntries={["/portal/dashboard"]}>
      <Routes>
        <Route path="/portal/dashboard" element={<PortalDashboard />} />
        <Route path="/portal/teacher" element={<p>v2 home</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return r;
}

describe("PortalDashboard while the teacher v2 flag is read", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a device that last showed v2: a placeholder frame, not the old dashboard", async () => {
    const { container } = await land("teacher");
    expect(container.querySelector('[data-frame="teacher"]')).not.toBeNull();
    expect(screen.queryByText(/Coaching Sessions/i)).toBeNull();
    expect(screen.queryByText("new ui home")).toBeNull();
  });

  it("any other device: today's dashboard at once, as before", async () => {
    const { container } = await land(null);
    expect(container.querySelector("[data-frame]")).toBeNull();
  });
});
