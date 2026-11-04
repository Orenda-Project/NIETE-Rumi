import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api, { portal } from "../../../services/api";
import { noticeTracker } from "../../notices/tracker";
import { useAuth } from "../../../hooks/useAuth";
import { forgetConfig, readConfigShared } from "../../../lib/useNewUi";
import { resetHomeMemo } from "../api";
import { resetHomeLookMemory, resetHomeOrderMemory } from "../useHomeData";
import Home from "../../pages/Home";

/**
 * bd-1q4z4o — the Home opened from WhatsApp's "open the app" link does not move after it first paints.
 *
 * Measured on sandbox before this (4 Nov 2026, 390x844 and 360x800, slow phone): every open changed its layout after the
 * first paint. A first open drew today's two-column Home, swapped it for the look, then added the Coach strip and the
 * Quizzes tile (the tiles' arrival animation played twice); a second open drew eight tiles and then Quizzes pushed seven
 * of them along (CLS 0.10). The operator's steer (4 Nov, ~19:55): the greeting first, a calm wait, then ALL the tiles
 * together, and the animation on that final set.
 */
const TEACHER = { firstName: "Coach Testwala", lastName: null, role: "teacher", phoneNumber: "test-teacher-9", schoolName: "IMSG I-10/1" };
const FIXED = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const QUIZ = "/quiz/teacher/tok123";
const LOOK = { teacherV2: true, teacherHomeCard: true, teacherHomeLook: true };
const COACH = { marks: 26, max: 38, at: "2026-10-22T08:06:27.000Z", id: "c-1" };
const ANSWER = { success: true, now: new Date().toISOString(), order: FIXED, orderOn: false, card: null, scores: { coach: COACH, observation: null }, quizHome: QUIZ, quizTile: true };

type BootWindow = Window & { __nieteBoot?: Record<string, unknown> };

function renderHome() {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** /config answers LOOK; /me/home waits until `answer` is called. */
function pendingHome() {
  let answer!: (v: unknown) => void;
  vi.mocked(portal.getConfig).mockResolvedValue({ features: LOOK } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return new Promise((r) => { answer = r; });
    return Promise.resolve({ data: { success: true, items: [] } });
  }) as never);
  return (v: unknown) => answer(v);
}

const homeReads = () => vi.mocked(api.get).mock.calls.filter(([u]) => u === "/me/home").length;

describe("teacher Home opened from WhatsApp: no movement after the first paint (bd-1q4z4o)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    noticeTracker.reset();
    forgetConfig();
    resetHomeMemo();
    resetHomeOrderMemory();
    resetHomeLookMemory();
    delete (window as BootWindow).__nieteBoot;
  });
  afterEach(() => { delete (window as BootWindow).__nieteBoot; });

  it("/config already read (the gate read it before Home mounted): the FIRST render is the look, never a frame of today's two-column Home", async () => {
    pendingHome();
    await readConfigShared();
    renderHome();
    // synchronously, before any effect has run
    expect(screen.getByTestId("home-band")).toBeTruthy();
    expect(screen.queryByTestId("home-language")).toBeNull();
  });

  it("while /me/home is on its way: the greeting, then a calm outline (not tappable), no tiles yet", async () => {
    pendingHome();
    await readConfigShared();
    renderHome();
    expect(screen.getByTestId("home-band").textContent).toContain("Coach Testwala");
    const hold = screen.getByTestId("home-look-hold");
    expect(hold.getAttribute("aria-busy")).toBe("true");
    expect(within(hold).queryAllByRole("link")).toHaveLength(0);
    expect(within(hold).getAllByTestId("home-look-hold-tile")).toHaveLength(9);
    for (const c of ["first:-mt-10", "relative", "z-[1]"]) expect(hold.className.split(" ")).toContain(c);
    expect(screen.queryByTestId("feature-tiles")).toBeNull();
  });

  it("a warm open (this phone remembers the block above the rows): still no tiles before the answer; the outline holds the remembered block", async () => {
    localStorage.setItem(`teacher-home-look:v1:${TEACHER.phoneNumber}`, "1");
    localStorage.setItem(`teacher-home-slot:v1:${TEACHER.phoneNumber}`, JSON.stringify({ card: 0, total: 58 }));
    pendingHome();
    renderHome();
    const hold = await screen.findByTestId("home-look-hold");
    expect(within(hold).getByTestId("home-look-slot").style.minHeight).toBe("58px");
    expect(screen.queryByTestId("feature-tiles")).toBeNull();
    expect(screen.queryAllByRole("link", { name: /Lesson Plans/ })).toHaveLength(0);
  });

  it("when /me/home answers: the strip and ALL nine tiles (Quizzes second) arrive in one commit, and the tiles are never re-drawn", async () => {
    localStorage.setItem(`teacher-home-look:v1:${TEACHER.phoneNumber}`, "1");
    localStorage.setItem(`teacher-home-slot:v1:${TEACHER.phoneNumber}`, JSON.stringify({ card: 0, total: 58 }));
    const answer = pendingHome();
    renderHome();
    await screen.findByTestId("home-look-hold");
    const seen: number[] = [];
    const grids = new Set<Element>();
    const watch = new MutationObserver(() => {
      const g = document.querySelector('[data-testid="feature-tiles"]');
      if (g) { seen.push(g.children.length); grids.add(g); }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    answer({ data: ANSWER });
    const grid = await screen.findByTestId("feature-tiles");
    await new Promise((r) => setTimeout(r, 30));
    watch.disconnect();
    expect(screen.getByTestId("home-scores")).toBeTruthy();
    expect(screen.queryByTestId("home-look-hold")).toBeNull();
    // eight feature links and the Quizzes tile (a button: it leaves the app) second
    expect(grid.children).toHaveLength(9);
    expect(grid.children[1]).toBe(screen.getByTestId("tile-quiz"));
    // the grid was only ever seen whole, and only one grid element was ever drawn (one arrival play)
    expect(seen.every((n) => n === 9)).toBe(true);
    expect(grids.size).toBe(1);
  });

  it("the revealed blocks fade in together (opacity only, so nothing moves; none under reduced motion)", async () => {
    const answer = pendingHome();
    await readConfigShared();
    renderHome();
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    answer({ data: ANSWER });
    const grid = await screen.findByTestId("feature-tiles");
    for (const el of [grid, screen.getByTestId("home-scores")]) expect(el.className.split(" ")).toContain("home-reveal");
  });

  it("index.html's boot read of /me/home has already answered: the first render is the final Home (no outline), and /me/home is not asked again", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ features: LOOK } as never);
    vi.mocked(api.get).mockImplementation(((url: string) => Promise.resolve({ data: url === "/me/home" ? ANSWER : { success: true, items: [] } })) as never);
    await readConfigShared();
    (window as BootWindow).__nieteBoot = { home: Promise.resolve(ANSWER), done: { home: ANSWER } };
    renderHome();
    expect(screen.queryByTestId("home-look-hold")).toBeNull();
    expect(screen.getByTestId("feature-tiles").children).toHaveLength(9);
    expect(screen.getByTestId("tile-quiz")).toBeTruthy();
    expect(screen.getByTestId("home-scores")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(homeReads()).toBe(0);
  });

  it("the boot read is still on its way: Home takes it (one request in all) and draws with its answer", async () => {
    let bootAnswer!: (v: unknown) => void;
    vi.mocked(portal.getConfig).mockResolvedValue({ features: LOOK } as never);
    vi.mocked(api.get).mockImplementation(((url: string) => Promise.resolve({ data: url === "/me/home" ? ANSWER : { success: true, items: [] } })) as never);
    await readConfigShared();
    (window as BootWindow).__nieteBoot = { home: new Promise((r) => { bootAnswer = r; }), done: {} };
    renderHome();
    expect(screen.getByTestId("home-look-hold")).toBeTruthy();
    bootAnswer(ANSWER);
    await screen.findByTestId("feature-tiles");
    await waitFor(() => expect(screen.getByTestId("home-scores")).toBeTruthy());
    expect(homeReads()).toBe(0);
  });
});
