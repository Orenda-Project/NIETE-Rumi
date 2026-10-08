import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — a v2 page takes her stored preferred_language (locked or not): the gate that wraps every v2
 * page asks GET /me/language once she is known to be a v2 teacher, and turns the page to it. Read only —
 * nothing is written. Anyone the gate turns away (no flag, a leader) is not asked: today's pages keep their
 * own rule (a locked choice only).
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
const get = vi.hoisted(() => vi.fn());
const set = vi.hoisted(() => vi.fn());
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get, set } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import TeacherGate from "./TeacherGate";
import { resetTeacherV2Memory } from "./useTeacherV2";
import { resetLanguageFollow } from "./i18n";

async function settle() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
}

async function visit(user: Record<string, unknown>, teacherV2: boolean) {
  resetTeacherV2Memory();
  resetLanguageFollow();
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { teacherV2 } } as never);
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<TeacherGate><p>v2 page</p></TeacherGate>} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
}

const TEACHER = { id: "t-1", role: "teacher", phoneNumber: "923001110001" };

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  get.mockResolvedValue({ language: "ur", locked: false });
});

describe("a v2 page follows her stored language", () => {
  it("a v2 teacher with Urdu stored (unlocked): the page turns Urdu; nothing is written", async () => {
    await visit(TEACHER, true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(i18n.language).toBe("ur");
    expect(set).not.toHaveBeenCalled();
  });

  it("no v2 flag: not asked, the page keeps its language", async () => {
    await visit(TEACHER, false);
    expect(get).not.toHaveBeenCalled();
    expect(i18n.language).toBe("en");
  });

  it("a leader (turned away by the gate): not asked", async () => {
    await visit({ ...TEACHER, role: "coach" }, true);
    expect(get).not.toHaveBeenCalled();
  });
});
