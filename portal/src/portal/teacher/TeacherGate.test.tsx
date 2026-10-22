import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

async function visit(user: Record<string, unknown> | null, features: Record<string, unknown> | "loading", loading = false, leaders = false) {
  resetTeacherV2Memory();
  if (features === "loading") vi.mocked(portal.getConfig).mockImplementation(() => new Promise(() => {}));
  else vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  vi.mocked(useAuth).mockReturnValue({ user, loading } as unknown as ReturnType<typeof useAuth>);
  render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<TeacherGate leaders={leaders}><p>v2 page</p></TeacherGate>} />
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

  it("a principal with the flag sees the page, exactly as a teacher does", async () => {
    await visit({ id: "p-1", role: "principal", phoneNumber: "923001110005" }, { teacherV2: true });
    expect(screen.getByText("v2 page")).toBeTruthy();
  });

  it("a principal without the flag goes to today's Home", async () => {
    await visit({ id: "p-1", role: "principal", phoneNumber: "923001110005" }, { teacherV2: false });
    expect(screen.queryByText("v2 page")).toBeNull();
  });

  // bd-fxk3t8: "nothing" was a white screen (3 s on sandbox). Still nothing of v2 — the
  // app's frame with placeholder blocks instead.
  it("while the flag is read: no v2 page, but the frame with placeholders — never blank", async () => {
    await visit(TEACHER, "loading");
    expect(screen.queryByText("v2 page")).toBeNull();
    expect(screen.queryByText("today's home")).toBeNull();
    expect(document.querySelector("[data-frame]")).not.toBeNull();
    expect(document.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(3);
  });

  it("while the user loads: the frame with placeholders — never blank", async () => {
    await visit(null, "loading", true);
    expect(screen.queryByText("v2 page")).toBeNull();
    expect(screen.queryByText("login")).toBeNull();
    expect(document.querySelector("[data-frame]")).not.toBeNull();
  });

  it("signed out goes to login", async () => {
    await visit(null, { teacherV2: true });
    expect(screen.getByText("login")).toBeTruthy();
  });
});

/**
 * bd-4joiqz — a route marked `leaders` (the lesson pages a leader reads: teacher/lessons/routes.tsx) also opens for the
 * leader family, whatever their teacher-app flag. Every other route, and everyone else, is exactly as above.
 */
describe("TeacherGate on a route the leader family may read", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["coach", "aeo", "supervisor", "school_leader", " Principal "])("%s, with or without the flag, sees the page", async (role) => {
    for (const teacherV2 of [false, true]) {
      await visit({ id: "l-1", role, phoneNumber: "923001110009" }, { teacherV2 }, false, true);
      expect(screen.getByText("v2 page")).toBeTruthy();
      cleanup();
    }
  });

  it("a teacher without the flag is still sent to today's Home", async () => {
    await visit(TEACHER, { teacherV2: false }, false, true);
    expect(screen.getByText("today's home")).toBeTruthy();
  });

  it("a user with no role and no flag is still sent to today's Home", async () => {
    await visit({ id: "u-1", role: null, phoneNumber: "923001110010" }, { teacherV2: false }, false, true);
    expect(screen.getByText("today's home")).toBeTruthy();
  });

  it("a teacher with the flag sees it, as before", async () => {
    await visit(TEACHER, { teacherV2: true }, false, true);
    expect(screen.getByText("v2 page")).toBeTruthy();
  });

  it("signed out still goes to login", async () => {
    await visit(null, { teacherV2: true }, false, true);
    expect(screen.getByText("login")).toBeTruthy();
  });

  it("a coach on a route NOT marked for leaders is still turned away", async () => {
    await visit({ id: "c-1", role: "coach", phoneNumber: "923001110004" }, { teacherV2: true }, false, false);
    expect(screen.queryByText("v2 page")).toBeNull();
  });
});
