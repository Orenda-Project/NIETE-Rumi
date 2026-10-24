import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api, { portal } from "../../../services/api";
import { noticeTracker } from "../../notices/tracker";
import { useAuth } from "../../../hooks/useAuth";
import { forgetConfig } from "../../../lib/useNewUi";
import { resetHomeMemo } from "../api";
import { resetHomeLookMemory, resetHomeOrderMemory } from "../useHomeData";
import Home from "../../pages/Home";
import { ROWS_WAIT_MS } from "./LookHome";
import { teacherPath } from "../../routes";
import type { TeacherFeature } from "../../paths";

/**
 * The Home's new look (portal_teacher_home_look, riding on portal_teacher_home_card), drawn through the real Home page:
 * the band is the hero, then the card, the progress strip, the rows (today's tiles in this car), then the reminder.
 * The card switch alone keeps the card build's tree.
 */
const TEACHER = { firstName: "Amina Testwala", lastName: null, role: "teacher", phoneNumber: "test-teacher-1", schoolName: "IMSG I-10/1" };
const FIXED = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const QUIZ = "/quiz/teacher/tok123";
const LOOK = { teacherHomeCard: true, teacherHomeLook: true };

type Body = Record<string, unknown>;
const body = (over: Body = {}): Body => ({
  success: true, now: new Date().toISOString(), order: FIXED, orderOn: false, card: null,
  scores: { coach: null, observation: null }, quizHome: QUIZ, ...over,
});
const COACH_CARD = { kind: "coach_report", title: "Fractions", score: 72, max: 100, at: "2026-10-18T09:00:00Z", href: "/x", id: "s-1" };
const LESSON_CARD = { kind: "lesson", title: "Parts of a Plant", from: "lp", href: QUIZ, id: "lp-1" };
const OBS = { marks: 29, max: 38, at: "", id: "o-1" };
const READY_ITEM = (id: string) => {
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  return {
    id, kind: "paper", state: "ready", title: null, grade: 4, subject: "Science", chapterNumber: 2, questions: 15,
    startedAt: iso(-600_000), readyAt: iso(-300_000), seenAt: iso(-290_000), openedAt: null, homeUntil: iso(3_600_000),
    paperId: `pp-${id}`, renderId: null, lessonId: null, lang: null, errorCode: null,
  };
};

function serve({ home, notices = [], features = LOOK }: { home?: Body; notices?: unknown[]; features?: Body }) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: home ?? body() });
    return Promise.resolve({ data: { success: true, items: notices } });
  }) as never);
  vi.mocked(api.post).mockResolvedValue({ status: 204 } as never);
}

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

/** The rows' features, in the order drawn (each links to teacherPath(feature)). */
const rows = () => within(screen.getByTestId("feature-tiles")).getAllByRole("link")
  .map((a) => FIXED.find((k) => teacherPath(k as TeacherFeature) === a.getAttribute("href")));

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("teacher Home, the new look", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    noticeTracker.reset();
    forgetConfig();
    resetHomeMemo();
    resetHomeOrderMemory();
    resetHomeLookMemory();
  });

  it("card ON, look OFF: the card build's tree, no band", async () => {
    serve({ home: body({ card: COACH_CARD }), features: { teacherHomeCard: true } });
    renderHome();
    await screen.findByTestId("home-next-card");
    expect(screen.queryByTestId("home-band")).toBeNull();
    expect(screen.getByTestId("feature-tiles")).toBeTruthy();
  });

  it("the look without the card is off (it rides on the card)", async () => {
    serve({ features: { teacherHomeCard: false, teacherHomeLook: true } });
    renderHome();
    await waitFor(() => expect(portal.getConfig).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("home-band")).toBeNull();
  });

  it("look ON, card day: band, then the card, the strip, the section label, the 8 rows in the fixed order, then the reminder", async () => {
    serve({ home: body({ card: COACH_CARD, scores: { coach: null, observation: OBS } }) });
    renderHome();
    const card = await screen.findByTestId("home-look-card");
    const band = screen.getByTestId("home-band");
    const strip = await screen.findByTestId("home-scores");
    const all = screen.getByTestId("home-look-all");
    const grid = screen.getByTestId("feature-tiles");
    expect(follows(band, card) && follows(card, strip) && follows(strip, all) && follows(all, grid)).toBe(true);
    expect(rows()).toEqual(FIXED);
    expect(screen.queryByTestId("home-look-ask")).toBeNull();
    expect(screen.queryByTestId("home-next-card")).toBeNull();
    expect(vi.mocked(api.get).mock.calls.filter(([u]) => u === "/me/home")).toHaveLength(1);
  });

  it("no card and no scores: the band, the question, then the rows; no section label", async () => {
    serve({ home: body() });
    renderHome();
    const ask = await screen.findByTestId("home-look-ask");
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    expect(ask.textContent).toBe("What would you like to do today?");
    expect(follows(screen.getByTestId("home-band"), ask) && follows(ask, screen.getByTestId("feature-tiles"))).toBe(true);
    expect(screen.queryByTestId("home-look-all")).toBeNull();
    expect(screen.queryByTestId("home-look-card")).toBeNull();
  });

  it("no card, scores: the strip sits under the band, then the question", async () => {
    serve({ home: body({ scores: { coach: null, observation: OBS } }) });
    renderHome();
    const strip = await screen.findByTestId("home-scores");
    expect(follows(strip, screen.getByTestId("home-look-ask"))).toBe(true);
  });

  it("a tray with rows: no full-kind card; a slim kind (lesson) still drawn", async () => {
    serve({ home: body({ card: COACH_CARD }), notices: [READY_ITEM("a")] });
    const first = renderHome();
    await screen.findByRole("region", { name: "Ready for you" });
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("home-look-card")).toBeNull();
    first.unmount();
    resetHomeMemo();
    serve({ home: body({ card: LESSON_CARD }), notices: [READY_ITEM("b")] });
    renderHome();
    expect((await screen.findByTestId("home-look-card")).getAttribute("data-home-card")).toBe("lesson");
  });

  it("the server's order when the order switch is on and it lands in time", async () => {
    const order = ["coaching", "lessons", "training", "observations", "assessment", "attendance", "classes", "analytics"];
    serve({ home: body({ order, orderOn: true }), features: { ...LOOK, teacherHomeOrder: true } });
    renderHome();
    await screen.findByTestId("home-band");
    await waitFor(() => expect(rows()).toEqual(order));
  });

  it("a look answered on is remembered for this teacher: the next open draws the band before /config answers", async () => {
    serve({ home: body() });
    const first = renderHome();
    await screen.findByTestId("home-band");
    first.unmount();
    forgetConfig();
    vi.mocked(portal.getConfig).mockReturnValue(new Promise(() => {}) as never);
    renderHome();
    expect(screen.getByTestId("home-band")).toBeTruthy();
  });

  it("the rows are the look's 2-up rows: 8 [data-row] links, each to its feature", async () => {
    serve({ home: body() });
    renderHome();
    await screen.findByTestId("home-band");
    const drawn = await waitFor(() => {
      const d = Array.from(screen.getByTestId("feature-tiles").querySelectorAll("[data-row]"));
      expect(d.length).toBe(8);
      return d;
    });
    expect(drawn.map((a) => a.getAttribute("data-row"))).toEqual(FIXED);
    expect(drawn.map((a) => a.getAttribute("href"))).toEqual(FIXED.map((k) => teacherPath(k as TeacherFeature)));
  });

  it("a lesson card left out by its cool-down: the day reads as a no-card day (the question, no section label)", async () => {
    localStorage.setItem(`teacher-home-card:v1:${TEACHER.phoneNumber}`, JSON.stringify({ [LESSON_CARD.id]: 3 }));
    serve({ home: body({ card: LESSON_CARD }) });
    renderHome();
    await screen.findByTestId("home-band");
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.getByTestId("home-look-ask")).toBeTruthy());
    expect(screen.queryByTestId("home-look-card")).toBeNull();
    expect(screen.queryByTestId("home-look-all")).toBeNull();
  });

  it("while /me/home loads: nothing tappable under the band (no rows, no question, no label); then all of it in one commit", async () => {
    let answer!: (v: unknown) => void;
    vi.mocked(portal.getConfig).mockResolvedValue({ features: LOOK } as never);
    vi.mocked(api.get).mockImplementation(((url: string) => {
      if (url === "/me/home") return new Promise((r) => { answer = r; });
      return Promise.resolve({ data: { success: true, items: [] } });
    }) as never);
    renderHome();
    await screen.findByTestId("home-band");
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    expect(screen.queryByTestId("feature-tiles")).toBeNull();
    expect(screen.queryByTestId("home-look-ask")).toBeNull();
    expect(screen.queryByTestId("home-look-all")).toBeNull();
    answer({ data: body({ card: COACH_CARD }) });
    const card = await screen.findByTestId("home-look-card");
    expect(screen.getByTestId("feature-tiles")).toBeTruthy();
    expect(screen.getByTestId("home-look-all")).toBeTruthy();
    expect(follows(card, screen.getByTestId("feature-tiles"))).toBe(true);
  });

  it("a cold open (no memory): /me/home starts with /config, not after it; one read in all", async () => {
    let configAnswer!: (v: unknown) => void;
    vi.mocked(portal.getConfig).mockReturnValue(new Promise((r) => { configAnswer = r; }) as never);
    vi.mocked(api.get).mockImplementation(((url: string) => {
      if (url === "/me/home") return Promise.resolve({ data: body({ card: COACH_CARD }) });
      return Promise.resolve({ data: { success: true, items: [] } });
    }) as never);
    renderHome();
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    configAnswer({ features: LOOK });
    await screen.findByTestId("home-look-card");
    expect(vi.mocked(api.get).mock.calls.filter(([u]) => u === "/me/home")).toHaveLength(1);
  });

  it(`an unanswered /me/home: the rows draw anyway after ${ROWS_WAIT_MS} ms`, async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ features: LOOK } as never);
    vi.mocked(api.get).mockImplementation(((url: string) => (url === "/me/home" ? new Promise(() => {}) : Promise.resolve({ data: { success: true, items: [] } }))) as never);
    renderHome();
    await screen.findByTestId("home-band");
    await new Promise((r) => setTimeout(r, ROWS_WAIT_MS - 500));
    expect(screen.queryByTestId("feature-tiles")).toBeNull();
    expect(await screen.findByTestId("feature-tiles", {}, { timeout: 2000 })).toBeTruthy();
  });

  it("the first thing under the band climbs 32 px (the page's 12 px top padding + 20) and paints above the band", async () => {
    serve({ home: body({ card: COACH_CARD }) });
    const first = renderHome();
    const card = await screen.findByTestId("home-look-card");
    for (const c of ["first:-mt-8", "relative", "z-[1]"]) expect(card.className.split(" ")).toContain(c);
    first.unmount();
    resetHomeMemo();
    serve({ home: body({ scores: { coach: null, observation: OBS } }) });
    renderHome();
    const strip = await screen.findByTestId("home-scores");
    for (const c of ["first:-mt-8", "relative", "z-[1]"]) expect(strip.className.split(" ")).toContain(c);
  });

  it("with no climber (no card and no strip, or while /me/home loads) the band is short and the first block starts 16 px under it", async () => {
    const cls = (id: string) => screen.getByTestId(id).className.split(" ");
    serve({ home: body({ card: COACH_CARD }) });
    const a = renderHome();
    await screen.findByTestId("home-look-card");
    expect(cls("home-band")).toContain("pb-[30px]");
    a.unmount();
    resetHomeMemo();
    serve({ home: body() });
    const b = renderHome();
    await screen.findByTestId("home-look-ask");
    expect(cls("home-band")).toContain("pb-[8px]");
    expect(cls("home-band")).not.toContain("pb-[30px]");
    for (const c of ["first:-mt-3", "first:pt-2"]) expect(cls("home-look-ask")).toContain(c);
    b.unmount();
    resetHomeMemo();
    vi.mocked(api.get).mockImplementation(((url: string) => (url === "/me/home" ? new Promise(() => {}) : Promise.resolve({ data: { success: true, items: [] } }))) as never);
    renderHome();
    await screen.findByTestId("feature-tiles", {}, { timeout: ROWS_WAIT_MS + 1000 });
    expect(cls("home-band")).toContain("pb-[8px]");
    for (const c of ["first:-mt-3", "first:pt-2"]) expect(cls("feature-tiles")).toContain(c);
  });

  describe("the card's slot while /me/home loads (no layout jump on a warm open)", () => {
    const SLOT = `teacher-home-slot:v1:${TEACHER.phoneNumber}`;
    const pending = () => {
      let answer!: (v: unknown) => void;
      vi.mocked(portal.getConfig).mockResolvedValue({ features: LOOK } as never);
      vi.mocked(api.get).mockImplementation(((url: string) => {
        if (url === "/me/home") return new Promise((r) => { answer = r; });
        return Promise.resolve({ data: { success: true, items: [] } });
      }) as never);
      return (v: unknown) => answer(v);
    };

    it("a remembered block {card, total}: a skeleton of the total climbs into the band, a white card of `card` px at its top", async () => {
      localStorage.setItem(SLOT, JSON.stringify({ card: 213, total: 300 }));
      const answer = pending();
      renderHome();
      const slot = await screen.findByTestId("home-look-slot");
      expect(slot.style.minHeight).toBe("300px");
      const white = within(slot).getByTestId("home-look-slot-card");
      expect(white.style.height).toBe("213px");
      expect(white.className.split(" ")).toContain("bg-white");
      expect(slot.className.split(" ")).not.toContain("bg-white");
      answer({ data: body({ card: COACH_CARD }) });
      await screen.findByTestId("home-look-card");
      expect(screen.queryByTestId("home-look-slot")).toBeNull();
    });

    it("an older memory (a bare card height): a skeleton of that height climbs into the band, then the card replaces it", async () => {
      localStorage.setItem(SLOT, "184");
      const answer = pending();
      renderHome();
      const slot = await screen.findByTestId("home-look-slot");
      expect(slot.getAttribute("aria-hidden")).toBe("true");
      expect(slot.style.minHeight).toBe("184px");
      for (const c of ["first:-mt-8", "relative", "z-[1]"]) expect(slot.className.split(" ")).toContain(c);
      expect(screen.getByTestId("home-band").className.split(" ")).toContain("pb-[30px]");
      answer({ data: body({ card: COACH_CARD }) });
      await screen.findByTestId("home-look-card");
      expect(screen.queryByTestId("home-look-slot")).toBeNull();
    });

    it("a warm open (slot memory): the rows draw at first paint under the slot, before /me/home answers, and stay the same rows when it does", async () => {
      localStorage.setItem(`teacher-home-look:v1:${TEACHER.phoneNumber}`, "1");
      localStorage.setItem(SLOT, JSON.stringify({ card: 213, total: 300 }));
      const answer = pending();
      renderHome();
      const slot = await screen.findByTestId("home-look-slot");
      const tiles = screen.getByTestId("feature-tiles");
      expect(follows(slot, tiles)).toBe(true);
      expect(rows()).toEqual(FIXED);
      answer({ data: body({ card: COACH_CARD }) });
      const card = await screen.findByTestId("home-look-card");
      expect(screen.queryByTestId("home-look-slot")).toBeNull();
      expect(screen.getByTestId("feature-tiles")).toBe(tiles);
      expect(follows(card, tiles)).toBe(true);
      expect(screen.queryByTestId("home-look-spacer")).toBeNull();
    });

    // The rows' top (relative to the page) as the browser would lay it out: `base`, plus a drawn spacer's height.
    const rowsAt = (base: { v: number }) => vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const sp = document.querySelector<HTMLElement>('[data-testid="home-look-spacer"]');
      const top = this.dataset.testid === "feature-tiles" ? base.v + (sp ? parseFloat(sp.style.height) : 0) : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });

    it("rows painted under a slot never move UP: a smaller answer (no card) fills the gap with a spacer, and the memory is rewritten", async () => {
      localStorage.setItem(`teacher-home-look:v1:${TEACHER.phoneNumber}`, "1");
      localStorage.setItem(SLOT, JSON.stringify({ card: 213, total: 300 }));
      const base = { v: 340 };
      const r = rowsAt(base);
      const answer = pending();
      renderHome();
      await screen.findByTestId("home-look-slot");
      const tiles = screen.getByTestId("feature-tiles");
      base.v = 96;
      answer({ data: body() });
      await screen.findByTestId("home-look-ask");
      const spacer = await screen.findByTestId("home-look-spacer");
      expect(spacer.style.height).toBe("244px");
      expect(spacer.getAttribute("aria-hidden")).toBe("true");
      expect(follows(spacer, tiles)).toBe(true);
      expect(follows(screen.getByTestId("home-look-ask"), spacer)).toBe(true);
      expect(screen.getByTestId("feature-tiles")).toBe(tiles);
      expect(tiles.getBoundingClientRect().top).toBe(340);
      await waitFor(() => expect(localStorage.getItem(SLOT)).toBeNull());
      r.mockRestore();
    });

    it("the memory written on a spacer load is the real block, without the spacer", async () => {
      localStorage.setItem(`teacher-home-look:v1:${TEACHER.phoneNumber}`, "1");
      localStorage.setItem(SLOT, JSON.stringify({ card: 213, total: 300 }));
      const base = { v: 340 };
      const r = rowsAt(base);
      const answer = pending();
      renderHome();
      await screen.findByTestId("home-look-slot");
      base.v = 150;
      answer({ data: body({ scores: { coach: null, observation: OBS } }) });
      expect((await screen.findByTestId("home-look-spacer")).style.height).toBe("190px");
      await waitFor(() => expect(JSON.parse(localStorage.getItem(SLOT) ?? "null")).toEqual({ card: 0, total: 140 }));
      r.mockRestore();
    });

    it("a taller answer moves the rows down, as today's card does: no spacer", async () => {
      localStorage.setItem(`teacher-home-look:v1:${TEACHER.phoneNumber}`, "1");
      localStorage.setItem(SLOT, JSON.stringify({ card: 213, total: 300 }));
      const base = { v: 340 };
      const r = rowsAt(base);
      const answer = pending();
      renderHome();
      await screen.findByTestId("home-look-slot");
      base.v = 400;
      answer({ data: body({ card: COACH_CARD, scores: { coach: null, observation: OBS } }) });
      await screen.findByTestId("home-look-card");
      expect(screen.queryByTestId("home-look-spacer")).toBeNull();
      r.mockRestore();
    });

    it("no slot memory: never a spacer (the cold hold draws the rows with the answer)", async () => {
      const r = rowsAt({ v: 96 });
      serve({ home: body() });
      renderHome();
      await screen.findByTestId("home-look-ask");
      expect(screen.queryByTestId("home-look-spacer")).toBeNull();
      r.mockRestore();
    });

    it("no memory: no skeleton", async () => {
      pending();
      renderHome();
      await screen.findByTestId("home-band");
      await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
      expect(screen.queryByTestId("home-look-slot")).toBeNull();
    });

    // jsdom lays nothing out: each block's top is given, so the remembered height is the rows' offset under the climber.
    const tops = (m: Record<string, number>) => vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = m[this.dataset.testid ?? ""] ?? 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });

    it("the slot holds the whole block above the rows: card + strip + label (less the one gap the slot keeps)", async () => {
      const r = tops({ "home-look-card": 100, "feature-tiles": 420 });
      const h = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.testid === "home-look-card" ? 205 : 0; });
      serve({ home: body({ card: COACH_CARD, scores: { coach: null, observation: OBS } }) });
      renderHome();
      await screen.findByTestId("home-scores");
      await waitFor(() => expect(JSON.parse(localStorage.getItem(SLOT) ?? "null")).toEqual({ card: 205, total: 310 }));
      r.mockRestore();
      h.mockRestore();
    });

    it("a no-card day with the strip remembers the strip + the question, so its rows hold too", async () => {
      const r = tops({ "home-scores": 100, "feature-tiles": 200 });
      serve({ home: body({ scores: { coach: null, observation: OBS } }) });
      renderHome();
      await screen.findByTestId("home-look-ask");
      await waitFor(() => expect(JSON.parse(localStorage.getItem(SLOT) ?? "null")).toEqual({ card: 0, total: 90 }));
      r.mockRestore();
    });

    it("measured again when the fonts land (a late Nastaliq swap grows the block)", async () => {
      let fontsLanded!: () => void;
      const ready = new Promise<void>((r) => { fontsLanded = r; });
      Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
      const m: Record<string, number> = { "home-look-card": 100, "feature-tiles": 306 };
      const r = tops(m);
      serve({ home: body({ card: COACH_CARD }) });
      renderHome();
      await screen.findByTestId("home-look-card");
      await waitFor(() => expect(JSON.parse(localStorage.getItem(SLOT) ?? "null")?.total).toBe(196));
      m["feature-tiles"] = 318;
      fontsLanded();
      await waitFor(() => expect(JSON.parse(localStorage.getItem(SLOT) ?? "null")?.total).toBe(208));
      r.mockRestore();
      delete (document as { fonts?: unknown }).fonts;
    });

    it("a drawn card remembers its height; a no-card answer forgets it", async () => {
      const h = tops({ "home-look-card": 100, "feature-tiles": 306 });
      serve({ home: body({ card: COACH_CARD }) });
      const a = renderHome();
      await screen.findByTestId("home-look-card");
      await waitFor(() => expect(JSON.parse(localStorage.getItem(SLOT) ?? "null")).toEqual({ card: 0, total: 196 }));
      h.mockRestore();
      a.unmount();
      resetHomeMemo();
      serve({ home: body() });
      renderHome();
      await screen.findByTestId("home-look-ask");
      await waitFor(() => expect(localStorage.getItem(SLOT)).toBeNull());
    });
  });
});

