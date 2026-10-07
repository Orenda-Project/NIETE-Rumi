import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-k23p38 — the Lesson Plans page every teacher has today (portal_new_ui off).
 *
 * "At the bottom of the Lesson Plan page it says Your lesson plans for grades 6-12. That is weird
 * broken stupid. The page should show her last 10 lesson plans opened. it can be 1-12, any." …
 * "All the LPs work the same way, no distinction on 6-12 1-5." … "on whatsapp too."
 * (operator, 7 Oct 2026)
 *
 *   Recent lesson plans   her last 10, any grade, newest first: opened here or sent on WhatsApp.
 *                         One she asked for that is still being written is first, as Preparing.
 *                         Tapping one opens it exactly as picking it from the dropdowns does.
 *   The picker            a grades 6-12 lesson gets the same "Open lesson plan" as grades 1-5;
 *                         one not written yet says Preparing after the tap, not before it.
 */

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
}));
// The viewer is checked as far as its file request: pdf.js is never reached.
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn(() => new Promise(() => {})) }));

import api, { portal } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { resetNewUiMemory } from "../lib/useNewUi";
import PortalCurriculum from "./PortalCurriculum";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3_600_000;

type Answer = () => unknown;
let routes: Record<string, Answer>;

const RECENT = () => ({
  success: true,
  plans: [
    {
      planKey: "k5:g4s_d2", kind: "k5", lessonId: "g4s_d2", found: true, title: "Leaves make food", grade: 4,
      subject: "General Science", chapterNumber: 2, chapterTitle: "Plants", dayLabel: "Day 2",
      lastUsedAt: iso(2 * HOUR), lastOpenedAt: iso(2 * HOUR), lastReceivedAt: null,
      open: { lane: "k5", lessonId: "g4s_d2" },
    },
    {
      planKey: "g612:g9p_newton", kind: "g612", segmentId: "g9p_newton", lang: "en", found: true, title: "Newton's second law",
      grade: 9, subject: "Physics", chapterNumber: 3, chapterTitle: "Dynamics", dayLabel: null,
      lastUsedAt: iso(26 * HOUR), lastOpenedAt: null, lastReceivedAt: iso(26 * HOUR),
      open: { lane: "g612", segmentId: "g9p_newton", lang: "en" },
    },
  ],
});

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { newUi: false } } as never);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", lastName: "Khan", role: "teacher", phoneNumber: "923001234567" },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.spyOn(window, "open").mockImplementation(() => null);
  routes = {
    "/curriculum/grades": () => ({ grades: [{ grade: 4 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 9 }] }),
    "/lesson-plans/recent": RECENT,
    "/lp612/mine": () => ({ lessons: [] }),
    "/lp612/subjects": () => ({ subjects: [{ subject: "Physics", lesson_count: 40 }] }),
    "/lp612/chapters": () => ({ chapters: [{ chapter_key: "c03", chapter_number: 3, chapter_title: "Dynamics", lesson_count: 2 }] }),
    "/lp612/lessons": () => ({ lessons: [
      { segment_id: "g9p_speed", title: "Speed and velocity", pages_label: "p.10-12", ready: true },
      { segment_id: "g9p_mass", title: "Mass and weight", pages_label: "p.13", ready: false },
    ] }),
    "/curriculum/lp/g4s_d2/file": () => PDF_BYTES,
    "/lp612/file/R1": () => PDF_BYTES,
    "/lp612/file/R7": () => PDF_BYTES,
  };
  http.get.mockImplementation(async (url: string) => {
    const answer = routes[url];
    if (!answer) throw new Error(`unexpected GET ${url}`);
    const data = await answer();
    if (data instanceof Error) throw data;
    return { data };
  });
  http.post.mockImplementation(async (url: string) => {
    if (url === "/lp612/request") return { data: { state: "ready", renderId: "R1" } };
    throw new Error(`unexpected POST ${url}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/curriculum"]}>
      <Routes>
        <Route path="/portal/curriculum" element={<PortalCurriculum />} />
      </Routes>
    </MemoryRouter>,
  );
}

const recentList = () => screen.findByTestId("recent-lesson-plans");
const rows = (list: HTMLElement) => within(list).getAllByRole("button");
const rowFor = async (title: string) => within(await recentList()).findByRole("button", { name: new RegExp(title) });
const viewer = () => screen.findByTestId("lesson-plan-viewer");
const fileCalls = (url: string) => http.get.mock.calls.filter(([u]) => u === url);

async function choose(index: number, option: RegExp) {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getAllByRole("combobox")[index]).not.toBeDisabled());
  await user.click(screen.getAllByRole("combobox")[index]);
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("bd-k23p38 — Recent lesson plans: her last 10, any grade", () => {
  it("replaces the grades 6-12 'My lesson plans' panel; asks for 10", async () => {
    renderPage();
    const list = await recentList();
    expect(screen.getByRole("heading", { name: "Recent lesson plans" })).toBeInTheDocument();
    expect(rows(list).map((r) => within(r).getByTestId("recent-title").textContent)).toEqual(["Leaves make food", "Newton's second law"]);
    expect(http.get).toHaveBeenCalledWith("/lesson-plans/recent", { params: { limit: 10 } });
    expect(document.body.textContent).not.toMatch(/My lesson plans|Grade 6-12 lessons|6-12|6–12/);
  });

  it("each row: the grade, the title, subject and chapter, and how she last had it", async () => {
    renderPage();
    const [grade4, grade9] = rows(await recentList());
    expect(grade4).toHaveTextContent("G4");
    expect(grade4).toHaveTextContent("General Science · Day 2 · Plants");
    expect(within(grade4).getByTestId("recent-tag")).toHaveTextContent(/Opened/);
    expect(grade9).toHaveTextContent("G9");
    expect(grade9).toHaveTextContent("Physics · Dynamics");
    expect(within(grade9).getByTestId("recent-tag")).toHaveTextContent(/On WhatsApp/);
  });

  it("a grades 6-12 plan she asked for and is still being written is first, as Preparing", async () => {
    routes["/lp612/mine"] = () => ({ lessons: [
      { renderId: "R9", segmentId: "g11m_p2s", state: "authoring", lang: "en", startedAt: iso(60_000), title: "Product-to-sum formulas", grade: 11, subject: "Mathematics" },
    ] });
    renderPage();
    const first = rows(await recentList())[0];
    expect(within(first).getByTestId("recent-title")).toHaveTextContent("Product-to-sum formulas");
    expect(within(first).getByTestId("recent-tag")).toHaveTextContent(/Preparing/);
  });

  it("tapping a grade 4 row opens it in the portal's viewer", async () => {
    renderPage();
    fireEvent.click(await rowFor("Leaves make food"));
    const v = await viewer();
    expect(within(v).getByRole("heading", { name: "Leaves make food" })).toBeInTheDocument();
    await waitFor(() => expect(fileCalls("/curriculum/lp/g4s_d2/file")).toHaveLength(1));
  });

  it("tapping a grade 9 row asks for it in its language, then opens it", async () => {
    renderPage();
    fireEvent.click(await rowFor("Newton's second law"));
    const v = await viewer();
    expect(http.post).toHaveBeenCalledWith("/lp612/request", { segment_id: "g9p_newton", lang: "en" });
    expect(within(v).getByRole("heading", { name: "Newton's second law" })).toBeInTheDocument();
    await waitFor(() => expect(fileCalls("/lp612/file/R1")).toHaveLength(1));
  });

  it("a grade 9 row that has to be written again: Preparing on the row, then it opens by itself", async () => {
    http.post.mockResolvedValue({ data: { state: "authoring", renderId: "R1" } });
    let polls = 0;
    routes["/lp612/status/R1"] = () => { polls += 1; return polls > 1 ? { state: "ready" } : { state: "authoring" }; };
    renderPage();
    const row = await rowFor("Newton's second law");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(row);
    await waitFor(() => expect(within(row).getByTestId("recent-tag")).toHaveTextContent(/Preparing/));
    await vi.advanceTimersByTimeAsync(7_000);
    await viewer();
    await waitFor(() => expect(fileCalls("/lp612/file/R1")).toHaveLength(1));
  });

  it("one written while she was away and never opened is Ready, and opens at once — nothing is asked for again", async () => {
    routes["/lesson-plans/recent"] = () => ({ plans: [] });
    routes["/lp612/mine"] = () => ({ lessons: [
      { renderId: "R7", segmentId: "g9p_forces", state: "ready", lang: "en", startedAt: iso(HOUR), completedAt: iso(HOUR - 180_000), title: "Forces", grade: 9, subject: "Physics" },
    ] });
    renderPage();
    const row = await rowFor("Forces");
    expect(within(row).getByTestId("recent-tag")).toHaveTextContent(/Ready/);
    fireEvent.click(row);
    await viewer();
    await waitFor(() => expect(fileCalls("/lp612/file/R7")).toHaveLength(1));
    expect(http.post).not.toHaveBeenCalled();
  });

  it("nothing used yet: no list", async () => {
    routes["/lesson-plans/recent"] = () => ({ plans: [] });
    renderPage();
    await screen.findByText("1. Grade");
    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/lesson-plans/recent", { params: { limit: 10 } }));
    expect(screen.queryByTestId("recent-lesson-plans")).toBeNull();
    expect(screen.queryByText("Recent lesson plans")).toBeNull();
  });

  it("the list failing to load: no list, and the picker still works", async () => {
    routes["/lesson-plans/recent"] = () => Object.assign(new Error("502"), { response: { status: 502 } });
    renderPage();
    await choose(0, /grade 9/i);
    expect(screen.queryByTestId("recent-lesson-plans")).toBeNull();
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});

describe("bd-k23p38 — every lesson opens the same way, grades 1 to 12", () => {
  async function pickGrade9(lesson: RegExp) {
    renderPage();
    await choose(0, /grade 9/i);
    await choose(1, /physics/i);
    await choose(2, /dynamics/i);
    await choose(3, lesson);
  }

  it("the lesson list says nothing about being written ('ready now', 'takes ~3 min')", async () => {
    renderPage();
    await choose(0, /grade 9/i);
    await choose(1, /physics/i);
    await choose(2, /dynamics/i);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("combobox")[3]);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Speed and velocity· p.10-12", "Mass and weight· p.13"]);
  });

  it("a lesson not written yet: the same 'Open lesson plan' as grades 1-5, no warning before it", async () => {
    await pickGrade9(/mass and weight/i);
    await screen.findByRole("heading", { name: "Mass and weight" });
    expect(screen.getByRole("button", { name: "Open lesson plan" })).toBeInTheDocument();
    expect(screen.queryByText(/write this lesson plan/i)).toBeNull();
    expect(screen.queryByText(/not written yet/i)).toBeNull();
  });

  it("after Open: Preparing, it opens by itself, and if she leaves it waits in Recent lesson plans", async () => {
    http.post.mockResolvedValue({ data: { state: "authoring", renderId: "R5" } });
    routes["/lp612/status/R5"] = () => ({ state: "authoring" });
    await pickGrade9(/mass and weight/i);
    routes["/lp612/mine"] = () => ({ lessons: [
      { renderId: "R5", segmentId: "g9p_mass", state: "authoring", lang: "en", startedAt: iso(1_000), title: "Mass and weight", grade: 9, subject: "Physics" },
    ] });
    fireEvent.click(await screen.findByRole("button", { name: "Open lesson plan" }));
    expect(await screen.findByText("Preparing…")).toBeInTheDocument();
    expect(screen.getByText(/opens by itself/i)).toBeInTheDocument();
    expect(screen.getByText(/waits in Recent lesson plans/i)).toBeInTheDocument();
    // Listed straight away, so leaving the page now still leaves a way back to it.
    const first = await waitFor(() => {
      const r = rows(screen.getByTestId("recent-lesson-plans"))[0];
      expect(within(r).getByTestId("recent-title")).toHaveTextContent("Mass and weight");
      return r;
    });
    expect(within(first).getByTestId("recent-tag")).toHaveTextContent(/Preparing/);
  });
});
