import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The card itself is RemindCard.test.tsx's: here only where Home puts it.
vi.mock("../notices/RemindCard", () => ({ RemindCard: () => <section data-testid="remind-card" /> }));
import api, { portal } from "../../services/api";
import { noticeTracker } from "../notices/tracker";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import { resetHomeMemo } from "../home/api";
import { resetHomeOrderMemory } from "../home/useHomeData";
import Home from "./Home";

/**
 * The evening reminder (portal_push_remind) sits AFTER the feature tiles on both Homes, so the first tile row (Lesson
 * Plans, Digital Coaching) and the one next-step card stay above the fold (home-org DESIGN R3; only "Ready for you"
 * shares the top).
 */
const TEACHER = { firstName: "Amina Testwala", lastName: null, role: "teacher", phoneNumber: "test-teacher-1", schoolName: "IMSG I-10/1" };
const FIXED = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const LESSON_CARD = { kind: "lesson", title: "Parts of a Plant", from: "lp", href: "/quiz/teacher/tok123", id: "lp-1" };
const COACH_CARD = { kind: "coach_report", title: "Fractions", score: 72, max: 100, at: "2026-10-18T09:00:00Z", href: "/x", id: "s-1" };

function serve(features: Record<string, unknown>, card: unknown = null) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: { success: true, now: new Date().toISOString(), order: FIXED, orderOn: false, card, scores: { coach: null, observation: null }, quizHome: null } });
    return Promise.resolve({ data: { success: true, items: [] } });
  }) as never);
  vi.mocked(api.post).mockResolvedValue({ status: 204 } as never);
}
const after = (a: Element, b: Element) => Boolean(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("teacher Home: the evening reminder comes after the tiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    noticeTracker.reset();
    forgetConfig();
    resetHomeMemo();
    resetHomeOrderMemory();
    vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false } as unknown as ReturnType<typeof useAuth>);
  });

  it("the home card ON, a slim card: after the tile grid (row 1 and the slim card stay on top)", async () => {
    serve({ teacherHomeCard: true }, LESSON_CARD);
    render(<MemoryRouter initialEntries={["/portal/teacher"]}><Home /></MemoryRouter>);
    await screen.findByTestId("home-slim-card");
    expect(after(screen.getByTestId("remind-card"), screen.getByTestId("feature-tiles"))).toBe(true);
  });

  it("the home card ON, a full card: after the full card AND the tiles", async () => {
    serve({ teacherHomeCard: true }, COACH_CARD);
    render(<MemoryRouter initialEntries={["/portal/teacher"]}><Home /></MemoryRouter>);
    const card = await screen.findByTestId("home-next-card");
    const remind = screen.getByTestId("remind-card");
    expect(after(remind, card)).toBe(true);
    expect(after(remind, screen.getByTestId("feature-tiles"))).toBe(true);
  });

  it("the home card OFF (today's Home): after the tiles too", async () => {
    serve({});
    render(<MemoryRouter initialEntries={["/portal/teacher"]}><Home /></MemoryRouter>);
    const tiles = await screen.findByTestId("feature-tiles");
    expect(after(screen.getByTestId("remind-card"), tiles)).toBe(true);
  });
});
