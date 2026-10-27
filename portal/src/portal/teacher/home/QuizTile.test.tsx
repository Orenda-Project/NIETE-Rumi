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

/**
 * The Home's "Quizzes" tile (portal_teacher_home_quiz_tile; D3 of the keyword-entry review, 27 Oct 2026). Today the
 * quiz home is reachable from the Home only through the ONE card, and only on a day its rung is class or lesson.
 * GET /me/home says `quizTile: true` only when the switch is on for the teacher and there is a quiz home; the tile is
 * then drawn under the eight (full width), on both Homes (the card's and the new look's), and a tap logs `quiz_tile`
 * and opens the signed quiz home as a page load. No `quizTile`, or no quiz home: no tile, the Home is today's.
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
  it("quizTile true → the Quizzes tile under the eight; a tap logs quiz_tile and opens the quiz home (a page load)", async () => {
    const assign = vi.fn();
    const real = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...real, assign } });
    try {
      serve(body({ quizTile: true }), features);
      renderHome();
      const tile = await screen.findByTestId("tile-quiz");
      expect(tile.textContent).toContain(HOME_CARD_COPY.quizTile);
      // under the eight feature tiles, never inside their grid (the eight still fill four rows)
      const tiles = screen.getByTestId("feature-tiles");
      expect(tiles.contains(tile)).toBe(false);
      expect(tiles.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  it("English \"Quizzes\"; Urdu the teacher app's own word for a quiz, «فوری جانچ»", () => {
    expect(HOME_CARD_COPY.quizTile).toBe("Quizzes");
    expect(HOME_CARD_COPY_UR.quizTile).toBe("فوری جانچ");
    expect([...HOME_CARD_COPY.quizTile].length).toBeLessThanOrEqual(20);
    expect([...HOME_CARD_COPY_UR.quizTile].length).toBeLessThanOrEqual(20);
  });
});
