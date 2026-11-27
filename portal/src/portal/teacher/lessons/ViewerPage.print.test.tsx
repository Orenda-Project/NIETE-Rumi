import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-m8zwt1.23.2 (queue #377) — Print. Since q372 a grades 1-5 plan is cut for a phone, so on paper it is a narrow
 * column. Print asks for the plan's A4 copy (?paper=1; the plan itself when it has none), in both layouts, grades 1-5
 * only (the 6-12 / GB lane has no paper copy). Download is unchanged: the phone copy, saved.
 */
const env = vi.hoisted(() => ({ features: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({ default: () => <div data-testid="viewer" /> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("./audience", () => ({ useLessonsLeader: () => false }));
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
import { LESSONS_V2_COPY as C, LESSONS_V2_COPY_UR as U } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const K5 = { source: { lane: "k5", lessonId: "g4e8s8", assetKind: "lesson" }, title: "Write a paragraph" };
const G612 = { source: { lane: "g612", renderId: "r-gb-1" }, title: "GB plan" };

beforeEach(() => {
  vi.clearAllMocks();
  resetShareAvailability();
  resetHomeMemo();
  env.features = {};
  http.get.mockImplementation(async (url: string) => {
    if (url === "/me/home") return { data: { success: true, quizHome: null, order: [], card: null, scores: {} } };
    if (url.startsWith("/curriculum/lp/")) return { data: { available: true, url: "https://x.r2.cloudflarestorage.com/p.pdf" } };
    if (url.startsWith("/lp612/status/")) return { data: { state: "ready", url: "https://x.r2.cloudflarestorage.com/q.pdf" } };
    throw Object.assign(new Error("404"), { response: { status: 404 } });
  });
  http.post.mockResolvedValue({ status: 204 });
});

const open = (lessonPlan: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: LESSONS_VIEWER, state: { lessonPlan } }]}>
    <Routes><Route path={LESSONS_VIEWER} element={<ViewerPage />} /></Routes>
  </MemoryRouter>,
);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("Print opens the plan's paper copy (bd-m8zwt1.23.2)", () => {
  it("the words, in English and Urdu", () => {
    expect(C.print).toBe("Print");
    expect(U.print).toBe("پرنٹ");
  });

  it("today's layout: Print asks for the paper copy (grades 1-5)", async () => {
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    open(K5);
    await settle();
    fireEvent.click(screen.getByTestId("lp-print"));
    await waitFor(() => expect(win).toHaveBeenCalled());
    expect(http.get).toHaveBeenCalledWith("/curriculum/lp/g4e8s8/pdf", { params: { kind: "lesson", paper: 1 } });
  });

  it("the slim row's Print asks for the paper copy", async () => {
    env.features = { lpViewerSlim: true };
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    open(K5);
    await settle();
    fireEvent.click(screen.getByTestId("action-strip-print"));
    await waitFor(() => expect(win).toHaveBeenCalled());
    expect(http.get).toHaveBeenCalledWith("/curriculum/lp/g4e8s8/pdf", { params: { kind: "lesson", paper: 1 } });
  });

  it("no Print on the 6-12 / GB lane, in either layout", async () => {
    open(G612);
    await settle();
    expect(screen.queryByTestId("lp-print")).toBeNull();
    env.features = { lpViewerSlim: true };
    open(G612);
    await settle();
    expect(screen.queryByTestId("action-strip-print")).toBeNull();
  });

  it("Download still asks for the phone copy, saved", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    open(K5);
    await settle();
    fireEvent.click(screen.getByTestId("share-open"));
    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/curriculum/lp/g4e8s8/pdf", { params: { kind: "lesson", download: 1 } }));
  });
});
