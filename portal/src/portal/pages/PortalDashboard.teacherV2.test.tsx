import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.1 — a teacher with portal_teacher_v2 who lands on today's Home
 * (/portal/dashboard — the post-login redirect, a bookmark, the app's cold start)
 * goes to the v2 Home. Flag off: today's dashboard, unchanged.
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
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function land(user: Record<string, unknown>, features: Record<string, unknown>) {
  resetNewUiMemory();
  resetTeacherV2Memory();
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  render(
    <MemoryRouter initialEntries={["/portal/dashboard"]}>
      <Routes>
        <Route path="/portal/dashboard" element={<PortalDashboard />} />
        <Route path="/portal/teacher" element={<p>v2 home</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
}

const TEACHER = { firstName: "Ayesha", role: "teacher", phoneNumber: "923001110001" };

describe("bd-fmf24g.1 — today's Home sends a v2 teacher to the v2 Home", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flag on: the v2 Home", async () => {
    await land(TEACHER, { teacherV2: true, newUi: true });
    expect(screen.getByText("v2 home")).toBeTruthy();
  });

  it("flag off: today's Home (the new UI one, for a new-UI teacher)", async () => {
    await land(TEACHER, { teacherV2: false, newUi: true });
    expect(screen.getByText("new ui home")).toBeTruthy();
    expect(screen.queryByText("v2 home")).toBeNull();
  });
});
