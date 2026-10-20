import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-4tsjcr (operator, 20 Oct 2026: "not at all"). On the New lesson plan page, a TEACHER whose every known class
 * grade is above 5 gets no FLN band: the page must be byte-identical to the page with the FLN switch OFF — no empty
 * heading, no placeholder, no gap — and the regular lesson-plan picker exactly as it is. A coach on the same page
 * still gets the band.
 *
 * Network boundary only: `services/api` (axios: the classes read and the K-5/6–12 loaders) and `fetch` (the FLN
 * client). PortalLayout is a pass-through, as in the golden switch-off test.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { ME_TEACHER, numG2, rhEnG1, rhUrG1 } from "./listFixtures";
import "../../teacher/routes";
import { NewLessonPage } from "../../teacher/lessons/NewLessonPage";
import { flnStrings } from "../strings";
import type { FlnMe } from "../types";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const EN = flnStrings("en");
const NEW = "/portal/teacher/lessons/new";
const ME_COACH: FlnMe = { lessons: true, share: true, role: "coach", ui_lang: "en" };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** null = the FLN switch is off (every /api/portal/fln/* answers 404); a body = /fln/me's answer. */
let me: FlnMe | null;
const flnCalls: string[] = [];

function catalogue(url: URL) {
  const subject = url.searchParams.get("subject");
  const grade = Number(url.searchParams.get("grade"));
  const base = subject === "num" ? numG2() : subject === "rh-ur" ? rhUrG1() : rhEnG1();
  return { ...base, grade, level: grade === 1 ? 1 : grade <= 3 ? 2 : 3 };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  flnCalls.length = 0;
  me = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const raw = String(input);
    if (!raw.startsWith("/api/portal/fln/")) throw new Error(`unexpected fetch ${raw}`);
    flnCalls.push(raw);
    const url = new URL(raw, "http://localhost");
    if (!me) return json(404, { error: "not_found" });
    if (url.pathname === "/api/portal/fln/me") return json(200, me);
    if (url.pathname === "/api/portal/fln/catalogue") return json(200, catalogue(url));
    return json(404, { error: "not_found" });
  }));
  // A teacher whose only class is Grade 8 Physics.
  const answers: Record<string, (p?: Record<string, unknown>) => unknown> = {
    "/me/grade-subjects": () => ({ success: true, combos: [
      { grade: 8, gradeCode: "grade_8", subject: "Physics", subjectKey: "physics", source: "class", featureKey: "Physics", available: true },
    ] }),
    "/curriculum/grades": () => ({ grades: [{ grade: 1, subject_count: 2 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 8 }] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "english", subject: "English", lesson_count: 40 }] }),
    "/lp612/subjects": () => ({ subjects: [{ subject: "Physics", lesson_count: 12 }] }),
  };
  http.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
    const hit = Object.entries(answers).find(([k]) => url === k || url.startsWith(`${k}/`));
    if (!hit) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: hit[1](cfg?.params) };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

/** The page as it stays: the picker drawn, the catalogue loaders answered, every FLN answer landed. */
async function newLessonPage(): Promise<string> {
  render(
    <MemoryRouter initialEntries={[NEW]}>
      <Routes>
        <Route path={NEW} element={<NewLessonPage />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: /Select grade and subject/ });
  await waitFor(() => expect(flnCalls.some((u) => u.endsWith("/fln/me"))).toBe(true));
  await settle();
  return document.body.innerHTML;
}

describe("New lesson plan page: a teacher of Grades 6–12 only gets no FLN band (bd-4tsjcr)", () => {
  it("hidden: the page is byte-identical to the FLN-switch-off page — no band, no heading, no gap", async () => {
    me = null;
    const off = await newLessonPage();
    cleanup();
    resetLessonPlans();

    me = ME_TEACHER;
    const teacher = await newLessonPage();
    // The band's body really mounted and decided (it read their classes), so this is the end state, not a load.
    expect(http.get.mock.calls.filter(([u]) => u === "/me/grade-subjects").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".fln-band")).toBeNull();
    expect(screen.queryByText(EN.band.title)).toBeNull();
    expect(flnCalls.filter((u) => u.includes("/catalogue"))).toHaveLength(0);
    expect(teacher).toBe(off);
  });

  it("a coach of Grade 8 on the same page still gets the band", async () => {
    me = ME_COACH;
    await newLessonPage();
    expect(await screen.findByText(EN.band.title)).toBeInTheDocument();
    const rows = await screen.findAllByRole("link", { name: new RegExp(EN.subject["rh-en"]) });
    expect(rows[0].getAttribute("href")).toBe("/portal/fln/list/rh-en?grade=1");
  });
});
