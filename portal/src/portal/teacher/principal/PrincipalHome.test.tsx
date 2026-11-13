import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api, { portal } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { noticeTracker } from "../notices/tracker";
import { forgetConfig } from "../../lib/useNewUi";
import { resetHomeMemo } from "../home/api";
import { resetHomeLookMemory, resetHomeOrderMemory } from "../home/useHomeData";
import i18n from "@/i18n/config";
import Home from "../pages/Home";
import { teacherPath } from "../routes";

/**
 * bd-33wxxi.2 — the principal app's Home (#55, Home A): the teacher Home's look exactly as a teacher has it, plus two
 * things and nothing else: the "Principal" tag in the band's footer slot (the kit's info StatusChip, PEOPLE.rolePrincipal)
 * and the "My school" card (SchoolHomeCard) after the progress strip and before the tiles. Both only for a principal
 * on the principal app (features.principalApp); a teacher's Home is unchanged.
 */
const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };
const TEACHER = { ...PRINCIPAL, firstName: "Amina Sample", role: "teacher", phoneNumber: "test-teacher-1" };
const LOOK = { teacherHomeCard: true, teacherHomeLook: true, teacherV2: true };
const HOME = { success: true, now: new Date().toISOString(), order: null, orderOn: false, card: null, scores: { coach: { marks: 31, max: 40, at: "", id: "c" }, observation: null }, quizHome: null };
const CARD = {
  success: true,
  school: { emis: "1126", name: "GGPS Sample", teachers: 13, lastVisitDaysAgo: null },
  overview: {
    teachers: 13, active: { now: 9, prev: 7 },
    lp: { total: 38, makers: 8, perTeacherDay: 0.6, prev: { total: 30, perTeacherDay: 0.5 } },
    training: { modules: 11, makers: 4, prev: { modules: 9 } },
    papers: { total: 5, makers: 3, prev: { total: 4 } },
  },
  tiles: [], teachers: [], scores: { dc: { count: 6, makers: 4 }, coach: { count: 2, makers: 2 } },
};

function serve({ features = { ...LOOK, principalApp: true }, card = CARD as unknown }: { features?: Record<string, unknown>; card?: unknown } = {}) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: HOME });
    if (url === "/principal/school/card") return card instanceof Error ? Promise.reject(card) : Promise.resolve({ data: card });
    return Promise.resolve({ data: { success: true, items: [] } });
  }) as never);
}

function renderHome(user: typeof PRINCIPAL) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes><Route path="/portal/teacher" element={<Home />} /></Routes>
    </MemoryRouter>,
  );
}

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the principal app's Home", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    noticeTracker.reset();
    forgetConfig();
    resetHomeMemo();
    resetHomeOrderMemory();
    resetHomeLookMemory();
    await i18n.changeLanguage("en");
  });

  it("a principal on the principal app: the Principal tag in the band, the school card between the strip and the tiles", async () => {
    serve();
    renderHome(PRINCIPAL);
    const band = await screen.findByTestId("home-band");
    await waitFor(() => expect(within(band).getByText("Principal")).toBeTruthy());
    const school = await screen.findByTestId("home-my-school");
    await waitFor(() => expect(within(school).getByText("38")).toBeTruthy());
    expect(within(school).getByText("My school · This week")).toBeTruthy();
    expect(within(school).getByText("9 of 13 teachers used NIETE this week")).toBeTruthy();
    // the four counts, each under the feature's own word; Digital Coaching wears the Home tile's word
    for (const [n, label] of [["38", "Lesson plans"], ["6", "Digital Coaching"], ["11", "Modules completed"], ["5", "Assessments"]]) {
      expect(within(school).getByText(n)).toBeTruthy();
      expect(within(school).getByText(label)).toBeTruthy();
    }
    // it opens Analytics (My school is its first tab)
    expect(within(school).getByRole("link").getAttribute("href")).toBe(teacherPath("analytics"));
    // placed after the progress strip and before the tiles
    expect(follows(screen.getByTestId("home-scores"), school)).toBe(true);
    expect(follows(school, screen.getByTestId("feature-tiles"))).toBe(true);
    // the school is the server's: only the session's card is asked, This week
    expect(vi.mocked(api.get)).toHaveBeenCalledWith("/principal/school/card", { params: { period: "week" } });
  });

  it("a principal whose row names no school: the card says No school, no numbers", async () => {
    serve({ card: { success: true, school: null } });
    renderHome(PRINCIPAL);
    const school = await screen.findByTestId("home-my-school");
    await waitFor(() => expect(within(school).getByText("No school")).toBeTruthy());
    expect(within(school).queryByText("38")).toBeNull();
  });

  it("the card's read failing: the frame keeps its place with dashes, never 0", async () => {
    serve({ card: new Error("down") });
    renderHome(PRINCIPAL);
    const school = await screen.findByTestId("home-my-school");
    await waitFor(() => expect(within(school).getAllByText("—").length).toBe(4));
    expect(within(school).queryByText("0")).toBeNull();
  });

  it("a teacher's Home is unchanged: no tag, no school card, nothing asked", async () => {
    serve({ features: LOOK });
    renderHome(TEACHER);
    const band = await screen.findByTestId("home-band");
    await screen.findByTestId("feature-tiles");
    expect(within(band).queryByText("Principal")).toBeNull();
    expect(screen.queryByTestId("home-my-school")).toBeNull();
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).not.toContain("/principal/school/card");
  });

  it("a principal the switch does not name (principalApp false): no tag, no card", async () => {
    serve({ features: { ...LOOK, principalApp: false } });
    renderHome(PRINCIPAL);
    const band = await screen.findByTestId("home-band");
    await screen.findByTestId("feature-tiles");
    expect(within(band).queryByText("Principal")).toBeNull();
    expect(screen.queryByTestId("home-my-school")).toBeNull();
  });

  it("in Urdu: the tag, the title and the Digital Coaching word in Urdu", async () => {
    await i18n.changeLanguage("ur");
    serve();
    renderHome(PRINCIPAL);
    const band = await screen.findByTestId("home-band");
    await waitFor(() => expect(within(band).getByText("ہیڈ ٹیچر")).toBeTruthy());
    const school = await screen.findByTestId("home-my-school");
    await waitFor(() => expect(within(school).getByText("میرا اسکول · یہ ہفتہ")).toBeTruthy());
    expect(within(school).getByText("ڈیجیٹل کوچنگ")).toBeTruthy();
  });
});
