import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { resetNewUiMemory } from "../lib/useNewUi";

/**
 * bd-5rz1v.14 — the new Lesson Plans screens ship behind `portal_new_ui`, and with the flag OFF
 * the Curriculum page must be exactly what it was.
 *
 * The snapshots in __snapshots__/ were recorded against PortalCurriculum as it was BEFORE the new
 * Lesson Plans existed (the layout and the navigation included): the picker with "My lesson
 * plans", the Assessment tab (?tab=assessment) and a lesson plan open in the viewer. Each flag-off
 * state is pinned on its own — the old page reads /config itself, so "config still loading" and
 * "config failed" already rendered the Assessment tab differently from "off", before any of this.
 * A difference of one class name fails this test.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn(), getDashboard: vi.fn() },
}));
// The viewer is pinned while its PDF is still loading: pdf.js is never reached.
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn(() => new Promise(() => {})) }));

import { useAuth } from "../hooks/useAuth";
import api, { portal } from "../services/api";
import PortalCurriculum from "./PortalCurriculum";

type ConfigMode = "off" | "absent" | "loading" | "fails";
type Page = "library" | "assessment" | "viewer";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function setConfig(mode: ConfigMode) {
  const fn = vi.mocked(portal.getConfig);
  fn.mockReset();
  if (mode === "off") fn.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: false } } as never);
  if (mode === "absent") fn.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null } } as never);
  if (mode === "loading") fn.mockImplementation(() => new Promise(() => {}));
  // What services/api's getConfig answers when /config fails: it never rejects.
  if (mode === "fails") {
    fn.mockResolvedValue({
      success: true,
      features: { assessmentGenerator: false, assessmentGeneratorMessage: "Being prepared", selfObservation: false, childTest: false },
    } as never);
  }
}

function answerApi() {
  http.get.mockImplementation(async (url: string) => {
    switch (url) {
      case "/curriculum/grades": return { data: { grades: [{ grade: 4, subject_count: 4 }] } };
      case "/lp612/grades": return { data: { grades: [{ grade: 9 }] } };
      case "/lp612/mine": return { data: { lessons: [{ renderId: "R1", segmentId: "S1", state: "ready", title: "Speed and velocity", grade: 9, subject: "Physics", lang: "en" }] } };
      // The viewer's PDF: still on its way when the snapshot is taken.
      case "/curriculum/lp/L1/file": return new Promise(() => {});
      default: throw new Error(`unexpected GET ${url}`);
    }
  });
}

const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

const ENTRIES: Record<Page, Parameters<typeof MemoryRouter>[0]["initialEntries"]> = {
  library: ["/portal/curriculum"],
  assessment: ["/portal/curriculum?tab=assessment"],
  viewer: [{
    pathname: "/portal/curriculum",
    state: { lessonPlan: { source: { lane: "k5", lessonId: "L1", assetKind: "lesson" }, title: "Leaves make food" } },
  }],
};

const READY: Record<Page, () => Promise<unknown>> = {
  library: () => screen.findByText("1. Grade"),
  assessment: () => screen.findByRole("tab", { name: "Assessment Generator", selected: true }),
  viewer: () => screen.findByTestId("lesson-plan-viewer"),
};

async function renderCurriculum(mode: ConfigMode, page: Page) {
  resetNewUiMemory();
  setConfig(mode);
  answerApi();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", lastName: "Khan", role: "teacher", phoneNumber: "923001234567" },
    loading: false,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  const { container } = render(
    <MemoryRouter initialEntries={ENTRIES[page]}>
      <PortalCurriculum />
    </MemoryRouter>,
  );
  await READY[page]();
  await settle();
  const html = normalise(container.innerHTML);
  cleanup();
  return html;
}

describe("bd-5rz1v.14 — flag off: the Curriculum page is exactly what it was", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const page of ["library", "assessment", "viewer"] as const) {
    it(`${page}: matches the page recorded before the new Lesson Plans, in every flag-off state`, { timeout: 30_000 }, async () => {
      for (const mode of ["off", "absent", "loading", "fails"] as const) {
        expect(await renderCurriculum(mode, page)).toMatchSnapshot(`${page} · ${mode}`);
      }
    });
  }
});
