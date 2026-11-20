import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * The plan screen, option A (portal_lp_viewer_slim → features.lpViewerSlim). Off: today's viewer (the Start DC card,
 * the action buttons, the dock). On: one slim row (Observe · Answer key · Download) over the plan, the plan, then
 * Quiz this lesson and Send on WhatsApp after it — Send only when the template is set AND her programme may get the PDF
 * (features.lpWhatsappSend) AND she is the teacher, not picking, not recording. No dock, except pick's Use this plan.
 */
const env = vi.hoisted(() => ({ features: {} as Record<string, unknown>, leader: false, recording: false, canSend: true }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({ default: () => <div data-testid="viewer" /> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => (env.recording ? { active: true } : null) }));
vi.mock("./audience", () => ({ useLessonsLeader: () => env.leader }));
vi.mock("../../lib/useNewUi", () => ({
  peekConfig: () => ({ features: env.features }),
  readConfigShared: () => Promise.resolve({ features: env.features }),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { resetHomeMemo } from "../home/api";
import { ViewerPage } from "./ViewerPage";
import { LESSONS_VIEWER } from "./paths";
import { LESSONS_V2_COPY as C } from "./copy";
import { HOME_CARD_COPY } from "../home/copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const VIEW = { source: { lane: "k5", lessonId: "g1e8s6", assetKind: "lesson" }, title: "Sounds" };
const DC = { grade: 3, subject: "math" };

beforeEach(() => {
  vi.clearAllMocks();
  resetShareAvailability();
  resetHomeMemo();
  env.features = { teacherHomeCard: true };
  env.leader = false;
  env.recording = false;
  env.canSend = true;
  http.get.mockImplementation(async (url: string) => {
    if (url === "/share/availability") return { data: { kinds: { lesson: env.canSend } } };
    if (url === "/me/home") return { data: { success: true, quizHome: "/quiz/teacher/tok", order: [], card: null, scores: {} } };
    if (url.startsWith("/curriculum/lp/")) return { data: { available: true, url: "https://x.r2.cloudflarestorage.com/p.pdf" } };
    throw Object.assign(new Error("404"), { response: { status: 404 } });
  });
  http.post.mockResolvedValue({ status: 204 });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const open = (state: Record<string, unknown> = {}) => render(
  <MemoryRouter initialEntries={[{ pathname: LESSONS_VIEWER, state: { lessonPlan: VIEW, dc: DC, ...state } }]}>
    <Routes><Route path={LESSONS_VIEWER} element={<ViewerPage />} /></Routes>
  </MemoryRouter>,
);
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("switch off: today's viewer", () => {
  it("the Start DC card, the dock, no slim row", async () => {
    open();
    expect(screen.getByRole("link", { name: C.startDc })).toBeInTheDocument();
    expect(screen.getByTestId("share-actions")).toBeInTheDocument();
    expect(screen.queryByTestId("action-strip")).toBeNull();
    // the quiz sits above the plan, as today
    const quiz = await screen.findByRole("button", { name: new RegExp(HOME_CARD_COPY.lp.quizThis) });
    expect(before(quiz, screen.getByTestId("viewer"))).toBe(true);
  });
});

describe("switch on", () => {
  beforeEach(() => { env.features = { teacherHomeCard: true, lpViewerSlim: true }; });

  it("one row (Observe · Answer key · Download) over the plan; no Start DC card, no dock", async () => {
    open();
    const strip = screen.getByTestId("action-strip");
    expect(before(strip, screen.getByTestId("viewer"))).toBe(true);
    const observe = screen.getByRole("link", { name: C.startDc });
    expect(observe).toHaveTextContent(C.observe);
    expect(observe.getAttribute("href")).toMatch(/coaching/);
    expect(screen.getByTestId("action-strip-key")).toHaveTextContent(C.answerKey);
    expect(screen.getByTestId("action-strip-download")).toHaveTextContent(C.download);
    expect(screen.queryByText(C.startDc)).toBeNull();
  });

  it("after the plan: Quiz this lesson, then Send on WhatsApp", async () => {
    open();
    const viewer = screen.getByTestId("viewer");
    const quiz = await screen.findByRole("button", { name: new RegExp(HOME_CARD_COPY.lp.quizThis) });
    const send = await screen.findByTestId("share-send");
    expect(before(viewer, quiz)).toBe(true);
    expect(before(quiz, send)).toBe(true);
    expect(screen.queryByTestId("share-open")).toBeNull();
  });

  it("no template on this deployment → no Send button at all (not the grey one)", async () => {
    env.canSend = false;
    open();
    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/share/availability"));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId("share-send")).toBeNull();
  });

  it("her programme gets no PDF on WhatsApp (lpWhatsappSend false) → no Send button", async () => {
    env.features = { ...env.features, lpWhatsappSend: false };
    open();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId("share-send")).toBeNull();
  });

  it("a leader: Answer key and Download only; no Quiz, no Send", async () => {
    env.leader = true;
    open();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId("action-strip-observe")).toBeNull();
    expect(screen.getByTestId("action-strip-key")).toBeInTheDocument();
    expect(screen.getByTestId("action-strip-download")).toBeInTheDocument();
    expect(screen.queryByTestId("share-send")).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(HOME_CARD_COPY.lp.quizThis) })).toBeNull();
  });

  it("while a lesson records: no Observe, no Download, no Send", async () => {
    env.recording = true;
    open();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId("action-strip-observe")).toBeNull();
    expect(screen.queryByTestId("action-strip-download")).toBeNull();
    expect(screen.queryByTestId("share-send")).toBeNull();
  });

  it("pick (From the library): no Observe, keeps its Use this lesson plan dock, no Send", async () => {
    open({ pick: { grade: 3, subject: "math" } });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId("action-strip-observe")).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(C.usePlan) })).toBeInTheDocument();
    expect(screen.queryByTestId("share-send")).toBeNull();
  });

  it("Download opens the plan's file, and its word says Opening… for 10 s", async () => {
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    open();
    fireEvent.click(screen.getByTestId("action-strip-download"));
    await waitFor(() => expect(win).toHaveBeenCalledWith("https://x.r2.cloudflarestorage.com/p.pdf", "_blank", "noopener,noreferrer"));
    expect(screen.getByTestId("action-strip-download")).not.toHaveTextContent(C.download);
  });
});
