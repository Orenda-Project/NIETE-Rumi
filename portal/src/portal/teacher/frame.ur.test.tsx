import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — the teacher v2 frame in Urdu: the menu, the page frame's Back, Home (greeting, tiles, today's
 * date), More (rows, Logout) — every word from the frame's bilingual copy, none left in English. Data (her
 * name, her school) stays as it is. MACHINE-DRAFTED Urdu (see the review file).
 */

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ default: { get: vi.fn(() => new Promise(() => {})) }, language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() } }));
vi.mock("../lib/recordingSession", () => ({ useLogoutGuard: (fn: () => void) => fn, useRecordingSession: () => null }));

import { useAuth } from "../hooks/useAuth";
import Home from "./pages/Home";
import More from "./pages/More";
import TeacherNavigation from "./TeacherNavigation";
import TeacherPage from "./TeacherPage";
import { TEACHER_COPY_UR } from "./copy";
import { todayLabel } from "./format";

const USER = { firstName: "Ayesha Bibi", role: "teacher", phoneNumber: "923001234567", schoolName: "IMSG I-10/1" };

beforeEach(async () => {
  vi.mocked(useAuth).mockReturnValue({ user: USER, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
});

const inRouter = (ui: React.ReactNode, at = "/portal/teacher") => render(<MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>);
const U = TEACHER_COPY_UR;

describe("the frame in Urdu", () => {
  it("the menu: every item in Urdu", () => {
    inRouter(<TeacherNavigation />);
    for (const w of [U.nav.home, U.nav.lessons, U.nav.coaching, U.nav.training, U.nav.more]) {
      expect(screen.getAllByText(w).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Lessons")).toBeNull();
    expect(screen.queryByText("More")).toBeNull();
  });

  it("Home: the greeting with her name as it is, the tiles, today's date in Urdu", () => {
    inRouter(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.home.greeting("Ayesha Bibi"));
    for (const w of Object.values(U.home.tiles)) expect(screen.getByText(w)).toBeTruthy();
    expect(screen.queryByText("Lesson Plans")).toBeNull();
    expect(screen.queryByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /)).toBeNull();
  });

  it("More: rows and Logout in Urdu; the Language row names English in English", () => {
    inRouter(<More />, "/portal/teacher/more");
    for (const w of [U.more.language, U.more.profile, U.more.logout]) {
      expect(screen.getAllByText(w).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.queryByText("Logout")).toBeNull();
  });

  it("the page frame's Back is named in Urdu", () => {
    inRouter(<TeacherPage title="T" backTo="/x"><p>x</p></TeacherPage>);
    expect(screen.getByRole("link", { name: U.back })).toBeTruthy();
  });
});

describe("today's date", () => {
  it("Urdu weekday and month, Western digits; English in the long form", () => {
    const thu = new Date("2026-10-08T10:00:00Z");
    expect(todayLabel(thu, "ur")).toBe("جمعرات 8 اکتوبر");
    // bd-fmf24g.22 — the long form, as the operator asked ("Thursday 8 October"); Urdu already was long.
    expect(todayLabel(thu, "en")).toBe("Thursday 8 October");
    expect(todayLabel(thu)).toBe("Thursday 8 October");
    expect(todayLabel(new Date("2026-10-11T10:00:00Z"), "en")).toBe("Sunday 11 October");
    expect(todayLabel(new Date("2026-12-31T20:00:00Z"), "en")).toBe("Friday 1 January"); // Karachi is UTC+5: already next day
  });
});
