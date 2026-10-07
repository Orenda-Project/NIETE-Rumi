import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from "react-router-dom";

/**
 * bd-4n7p4 — there is no Assessment tab any more: the Assessment Generator is its own page,
 * /portal/assessment. An old link or bookmark to /portal/curriculum?tab=assessment goes there.
 * Without the parameter (or with any other value) this is the Lesson Plans page, with no tabs.
 *
 * (History: bd-5rz1v.12 — the new UI's menu has its own "Assessment" item. Until
 * Assessment is a page of its own it opens /portal/curriculum?tab=assessment,
 * so the page must open on the Assessment tab when asked — including when she
 * is already on Lesson Plans and taps Assessment (same page, new query).
 * Without the parameter the page opens on Lesson Plans exactly as before.)
 */

// The same stand-ins as PortalCurriculum.viewer.test.tsx: the network (api), the
// layout, and pdf.js; the page itself and the recording session are real.
// A STABLE toast: the page's effects depend on it, so a new function per render loops them.
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn() },
}));
vi.mock("../lib/pdfjs", () => ({ loadPdfjs: vi.fn() }));
vi.mock("@/lib/runtime", async (orig) => ({
  ...(await orig<typeof import("@/lib/runtime")>()),
  isNativeApp: () => false,
}));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));
vi.mock("../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn() }));

import api, { portal } from "../services/api";
import { RecordingSessionProvider } from "../lib/recordingSession";
import PortalCurriculum from "./PortalCurriculum";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(portal.getConfig).mockResolvedValue({ features: { assessmentGenerator: false } } as Awaited<ReturnType<typeof portal.getConfig>>);
  http.get.mockImplementation(async (url: string) => {
    switch (url) {
      case "/curriculum/grades": return { data: { grades: [{ grade: 4 }] } };
      case "/lp612/grades": return { data: { grades: [{ grade: 9 }] } };
      case "/curriculum/subjects": return { data: { subjects: [{ subject_key: "english", subject: "English", lesson_count: 12 }] } };
      case "/lp612/mine": return { data: { lessons: [] } };
      default: throw new Error(`unexpected GET ${url}`);
    }
  });
});

beforeAll(() => {
  // What jsdom lacks for Radix Select (as in PortalCurriculum.viewer.test.tsx).
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

let go: (to: string) => void = () => {};
const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; };
const Navigator = () => { go = useNavigate(); return null; };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RecordingSessionProvider>
        <Navigator />
        <Routes>
          <Route path="/portal/curriculum" element={<PortalCurriculum />} />
          <Route path="/portal/assessment" element={<Where />} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
}

describe("PortalCurriculum ?tab=", () => {
  it("is the Lesson Plans page, with no tabs, when there is no parameter", async () => {
    renderAt("/portal/curriculum");
    expect(await screen.findByRole("heading", { name: "Lesson Plans" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Assessment Generator")).toBeNull();
    expect(screen.queryByText("Curriculum Library")).toBeNull();
    expect(await screen.findByText("1. Grade")).toBeInTheDocument();
  });

  it("?tab=assessment redirects to /portal/assessment", async () => {
    renderAt("/portal/curriculum?tab=assessment");
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/portal\/assessment$/);
  });

  it("redirects when she is already on the page and a link adds ?tab=assessment", async () => {
    renderAt("/portal/curriculum");
    await screen.findByRole("heading", { name: "Lesson Plans" });
    act(() => go("/portal/curriculum?tab=assessment"));
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/portal\/assessment$/);
  });

  it("ignores any other value", async () => {
    renderAt("/portal/curriculum?tab=nonsense");
    expect(await screen.findByRole("heading", { name: "Lesson Plans" })).toBeInTheDocument();
    expect(screen.queryByTestId("where")).toBeNull();
  });
});
