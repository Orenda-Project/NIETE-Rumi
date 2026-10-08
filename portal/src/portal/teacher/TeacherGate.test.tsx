import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.1 — the /portal/teacher pages exist only for a teacher with
 * portal_teacher_v2. Anyone else who lands on one (a bookmark, a shared link)
 * goes to today's Home; while the flag is read nothing of v2 renders.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import TeacherGate from "./TeacherGate";
import { resetTeacherV2Memory } from "./useTeacherV2";

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function visit(user: Record<string, unknown> | null, features: Record<string, unknown> | "loading", loading = false) {
  resetTeacherV2Memory();
  if (features === "loading") vi.mocked(portal.getConfig).mockImplementation(() => new Promise(() => {}));
  else vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  vi.mocked(useAuth).mockReturnValue({ user, loading } as unknown as ReturnType<typeof useAuth>);
  render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<TeacherGate><p>v2 page</p></TeacherGate>} />
        <Route path="/portal/dashboard" element={<p>today's home</p>} />
        <Route path="/portal/leader" element={<p>my patch</p>} />
        <Route path="/portal/login" element={<p>login</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
}

const TEACHER = { id: "t-1", role: "teacher", phoneNumber: "923001110001" };

describe("TeacherGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a teacher with the flag sees the page", async () => {
    await visit(TEACHER, { teacherV2: true });
    expect(screen.getByText("v2 page")).toBeTruthy();
  });

  it("a teacher without the flag goes to today's Home", async () => {
    await visit(TEACHER, { teacherV2: false });
    expect(screen.getByText("today's home")).toBeTruthy();
  });

  it("a coach with the flag goes to today's Home (which sends a leader on to My Patch)", async () => {
    await visit({ id: "c-1", role: "coach", phoneNumber: "923001110004" }, { teacherV2: true });
    expect(screen.queryByText("v2 page")).toBeNull();
  });

  it("nothing renders while the flag is read", async () => {
    await visit(TEACHER, "loading");
    expect(screen.queryByText("v2 page")).toBeNull();
    expect(screen.queryByText("today's home")).toBeNull();
  });

  it("signed out goes to login", async () => {
    await visit(null, { teacherV2: true });
    expect(screen.getByText("login")).toBeTruthy();
  });
});
