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
});
