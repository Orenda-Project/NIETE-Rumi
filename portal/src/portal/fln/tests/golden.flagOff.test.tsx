import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-t7zk3t.11 — SPEC_v2 §7 goldens: with the FLN switch OFF the K-5 / 6–12 pages are byte-identical.
 *
 * The snapshots in __snapshots__/golden.flagOff.test.tsx.snap were RECORDED on the pre-FLN code (sandbox 67e22b0 +
 * c4a2c874f, before any hook line). With the hooks in place and every `/api/portal/fln/*` call answering 404, each
 * render below must match them byte for byte. Never re-record them with `-u` on a branch that carries the hooks.
 *
 *   NewLessonPage   first shown; the class tray opened at grade 1; at grade 8 (document.body: the tray is a portal)
 *   OpenPlanPage    `?plan=k5:<id>` and `?plan=g612:<seg>&lang=ur` → where it went, with what state, what it asked
 *
 * Network boundary only: `services/api` (axios, the K-5/6–12 loaders) and `fetch` (the FLN client). The page chrome
 * (PortalLayout: auth, notices, nav) is a pass-through, as in the lesson pages' own tests — FLN adds nothing to it.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { ME_TEACHER, rhEnG1, rhUrG1, numG2 } from "./listFixtures";
// The teacher route table first: OpenPlanPage → teacher/routes → lessons/routes → OpenPlanPage is a cycle that,
// entered from OpenPlanPage, leaves lessons/routes holding `undefined` (a harmless React warning, but noise).
import "../../teacher/routes";
import { NewLessonPage } from "../../teacher/lessons/NewLessonPage";
import { OpenPlanPage } from "../../teacher/lessons/OpenPlanPage";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

/** The FLN switch: 404 = off (the golden); a body = on (proves the 404 case is really exercised). */
let flnAnswer: (url: string) => Response;
const flnCalls: string[] = [];
const off = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  flnCalls.length = 0;
  flnAnswer = off;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/portal/fln/")) { flnCalls.push(url); return flnAnswer(url); }
    throw new Error(`unexpected fetch ${url}`);
  }));
  const answers: Record<string, (p?: Record<string, unknown>) => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 1, gradeCode: "grade_1", subject: "English", subjectKey: "english", source: "class", featureKey: "english", available: true },
    ] }),
    "/curriculum/grades": () => ({ grades: [{ grade: 1, subject_count: 2 }, { grade: 2, subject_count: 1 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 8 }] }),
    "/curriculum/subjects": (p) => ({ subjects: p?.grade === 1
      ? [{ subject_key: "english", subject: "English", lesson_count: 40 }, { subject_key: "math", subject: "Math", lesson_count: 30 }]
      : [{ subject_key: "math", subject: "Math", lesson_count: 30 }] }),
    "/lp612/subjects": () => ({ subjects: [{ subject: "Physics", lesson_count: 12 }, { subject: "اردو", lesson_count: 9 }] }),
  };
  http.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
    const hit = Object.entries(answers).find(([k]) => url === k || url.startsWith(`${k}/`));
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit[1](cfg?.params) };
  });
  http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === "/lp612/request") return { data: { state: "ready", renderId: `R-${String(body.segment_id)}-${String(body.lang)}` } };
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Let every pending answer land (both loaders, the FLN 404) so the page is as it stays, not mid-load. */
async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where" data-path={loc.pathname} data-search={loc.search} data-state={JSON.stringify(loc.state ?? null)} />;
}

function renderAt(path: string, element: React.ReactElement, routePath: string) {
  const [pathname, search] = path.split("?");
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : "" }]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const NEW = "/portal/teacher/lessons/new";

async function newLessonPage() {
  renderAt(NEW, <NewLessonPage />, NEW);
  await screen.findByRole("button", { name: /Select grade and subject/ });
  await waitFor(() => expect(http.get).toHaveBeenCalledWith("/lp612/subjects", { params: { grade: 8 } }));
  await settle();
}

async function openTrayAt(grade: number) {
  fireEvent.click(screen.getByRole("button", { name: /Select grade and subject/ }));
  const sheet = screen.getByRole("dialog", { name: /Select grade and subject/ });
  fireEvent.click(within(sheet).getByRole("radio", { name: new RegExp(`^Grade ${grade}( ·|$)`) }));
  await settle();
  return sheet;
}

describe("golden, switch OFF: NewLessonPage (the v2 subject picker) is byte-identical", () => {
  it("as first shown", async () => {
    await newLessonPage();
    expect(document.body.innerHTML).toMatchSnapshot();
  });

  it("the class tray opened at grade 1", async () => {
    await newLessonPage();
    const sheet = await openTrayAt(1);
    expect(within(sheet).getByRole("link", { name: /Grade 1 · English · Your class/ })).toBeTruthy();
    expect(document.body.innerHTML).toMatchSnapshot();
  });

  it("the class tray opened at grade 8", async () => {
    await newLessonPage();
    const sheet = await openTrayAt(8);
    expect(within(sheet).getByRole("button", { name: /Physics/ })).toBeTruthy();
    expect(document.body.innerHTML).toMatchSnapshot();
  });
});

describe("golden, switch OFF: OpenPlanPage keeps the k5 / g612 keys where they went", () => {
  async function opened(path: string) {
    renderAt(path, <OpenPlanPage />, "/portal/teacher/lessons/open");
    await waitFor(() => expect(screen.getByTestId("where").getAttribute("data-path")).not.toBe("/portal/teacher/lessons/open"));
    await settle();
    const w = screen.getByTestId("where");
    return {
      path: w.getAttribute("data-path"),
      search: w.getAttribute("data-search"),
      state: JSON.parse(w.getAttribute("data-state") || "null"),
      posts: http.post.mock.calls,
      fln: [...flnCalls],
    };
  }

  it("?plan=k5:<id> → the viewer with the k5 source", async () => {
    expect(await opened("/portal/teacher/lessons/open?plan=k5:L-4521&title=Roots&grade=4")).toMatchSnapshot();
  });

  it("?plan=g612:<seg>&lang=ur → asks for it in Urdu, then the viewer", async () => {
    expect(await opened("/portal/teacher/lessons/open?plan=g612:SEG-77&lang=ur&title=Motion&grade=9")).toMatchSnapshot();
  });
});

/**
 * Control for the goldens above (added WITH the hook lines; it cannot pass on the pre-FLN code): the band is really
 * on the page, it really asks /api/portal/fln/*, and with the switch on it shows — so "byte-identical when off" is
 * the 404 answer doing its work, not a band that never rendered.
 */
describe("control, switch ON: the FLN band appears under the picker", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  it("OFF: the page asked /api/portal/fln/me, was answered 404, and drew nothing for it", async () => {
    await newLessonPage();
    expect(flnCalls).toContain("/api/portal/fln/me");
    expect(document.querySelector(".fln-band")).toBeNull();
  });

  it("ON: three rows, each linking to its list at the teacher's grade; the page is no longer the golden", async () => {
    flnAnswer = (url) => {
      if (url === "/api/portal/fln/me") return json(ME_TEACHER);
      const q = new URL(url, "http://localhost").searchParams;
      if (url.startsWith("/api/portal/fln/catalogue") && q.get("grade") === "1") {
        const subject = q.get("subject");
        return json(subject === "rh-en" ? rhEnG1() : subject === "rh-ur" ? rhUrG1() : { ...numG2(), grade: 1, level: 1 });
      }
      return off();
    };
    await newLessonPage();
    const band = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("section.fln-band");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(within(band).getAllByRole("link")).toHaveLength(3));
    expect(within(band).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/portal/fln/list/rh-en?grade=1", "/portal/fln/list/rh-ur?grade=1", "/portal/fln/list/num?grade=1",
    ]);
    expect(flnCalls.filter((u) => u.startsWith("/api/portal/fln/catalogue?grade=1&subject="))).toHaveLength(3);
    // It sits on the page after the class picker (below it), inside the New lesson plan page.
    const page = screen.getByTestId("lessons-new");
    const picker = screen.getByRole("button", { name: /Select grade and subject/ });
    expect(page.contains(band)).toBe(true);
    expect(picker.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
