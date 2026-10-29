import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api, { portal } from "../../services/api";
import { noticeTracker } from "../notices/tracker";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import { readHome, resetHomeMemo } from "./api";
import { resetHomeLookMemory, resetHomeOrderMemory } from "./useHomeData";
import { HOME_CARD_COPY, HOME_CARD_COPY_UR } from "./copy";
import Home from "../pages/Home";
import { teacherPath } from "../routes";
import type { TeacherFeature } from "../paths";

/**
 * The Home's "Quizzes" tile (portal_teacher_home_quiz_tile; D3 of the keyword-entry review, 27 Oct 2026). Today the
 * quiz home is reachable from the Home only through the ONE card, and only on a day its rung is class or lesson.
 * GET /me/home says `quizTile: true` only when the switch is on for the teacher and there is a quiz home; the tile is
 * then the 2nd tile of the grid, right after Lesson plans (COS ruling 27 Oct: by 7-day reach Lesson plans leads, and a
 * quiz follows a lesson), the same kind of tile as the rest, on both Homes (the card's and the new look's); the other
 * tiles keep their order one place on, and the 9th spans both columns. A tap logs `quiz_tile` and opens the signed
 * quiz home as a page load. No `quizTile`, or no quiz home: no tile, the grid is today's eight.
 */
const TEACHER = { firstName: "Amina Testwala", lastName: null, role: "teacher", phoneNumber: "test-teacher-qt", schoolName: "IMSG I-10/1" };
const FIXED = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const QUIZ = "/quiz/teacher/tok123";
const CARD = { teacherHomeCard: true };
const LOOK = { teacherHomeCard: true, teacherHomeLook: true };

type Body = Record<string, unknown>;
const body = (over: Body = {}): Body => ({
  success: true, now: new Date().toISOString(), order: FIXED, orderOn: false, card: null,
  scores: { coach: null, observation: null }, quizHome: QUIZ, ...over,
});

function serve(home: Body, features: Body) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: home });
    return Promise.resolve({ data: { success: true, items: [] } });
  }) as never);
  vi.mocked(api.post).mockResolvedValue({ status: 204 } as never);
}

function renderHome() {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<Home />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  forgetConfig();
  resetHomeMemo();
  resetHomeOrderMemory();
  resetHomeLookMemory();
});

describe.each([["the card's Home", CARD], ["the new look", LOOK]])("%s", (_name, features) => {
  it("quizTile true → Quizzes is the 2nd tile of the grid, right after Lesson plans; the 9th tile spans the full width; a tap logs quiz_tile and opens the quiz home", async () => {
    const assign = vi.fn();
    const real = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...real, assign } });
    try {
      serve(body({ quizTile: true }), features);
      renderHome();
      const tile = await screen.findByTestId("tile-quiz");
      expect(tile.textContent).toContain(HOME_CARD_COPY.quizTile);
      // IN the grid, the second of nine, the same kind of tile as the others (COS ruling 27 Oct: a quiz follows a lesson)
      const grid = screen.getByTestId("feature-tiles");
      const cells = Array.from(grid.children) as HTMLElement[];
      expect(cells).toHaveLength(9);
      expect(cells[1]).toBe(tile);
      expect(cells[0].getAttribute("href")).toBe(teacherPath("lessons" as TeacherFeature));
      expect(cells[2].getAttribute("href")).toBe(teacherPath(FIXED[1] as TeacherFeature));
      // every other tile keeps its order, one place on
      expect(cells.filter((c) => c !== tile).map((c) => c.getAttribute("href"))).toEqual(FIXED.map((k) => teacherPath(k as TeacherFeature)));
      // nine in two columns: the last one spans both, no other does
      expect(cells[8].className).toMatch(/\bcol-span-2\b/);
      cells.slice(0, 8).forEach((c) => expect(c.className).not.toMatch(/\bcol-span-2\b/));
      await userEvent.setup().click(tile);
      expect(vi.mocked(api.post)).toHaveBeenCalledWith("/me/home/tap", { kind: "quiz_tile" });
      await waitFor(() => expect(assign).toHaveBeenCalledWith(QUIZ));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: real });
    }
  });

  it.each([
    ["no quizTile (the switch off)", body()],
    ["quizTile false", body({ quizTile: false })],
    ["quizTile true but no quiz home", body({ quizTile: true, quizHome: null })],
  ])("%s → no tile", async (_l, home) => {
    serve(home, features);
    renderHome();
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    await screen.findByTestId("feature-tiles");
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("tile-quiz")).toBeNull();
    // today's grid exactly: the eight, none of them wide
    const cells = Array.from(screen.getByTestId("feature-tiles").children) as HTMLElement[];
    expect(cells.map((c) => c.getAttribute("href"))).toEqual(FIXED.map((k) => teacherPath(k as TeacherFeature)));
    cells.forEach((c) => expect(c.className).not.toMatch(/\bcol-span-2\b/));
  });
});

describe("readHome", () => {
  it("quizTile is true only for a real true with a readable quiz home", () => {
    expect(readHome(body({ quizTile: true }))?.quizTile).toBe(true);
    expect(readHome(body({ quizTile: "true" }))?.quizTile).toBe(false);
    expect(readHome(body())?.quizTile).toBe(false);
    expect(readHome(body({ quizTile: true, quizHome: "https://elsewhere.example/x" }))?.quizTile).toBe(false);
  });
});

describe("the words", () => {
  it("English \"Quizzes\"; Urdu «کوئز», the bot's word (bd-bmc9a0.6, the operator, 29 Oct)", () => {
    expect(HOME_CARD_COPY.quizTile).toBe("Quizzes");
    expect(HOME_CARD_COPY_UR.quizTile).toBe("کوئز");
    expect([...HOME_CARD_COPY.quizTile].length).toBeLessThanOrEqual(20);
    expect([...HOME_CARD_COPY_UR.quizTile].length).toBeLessThanOrEqual(20);
  });
});
