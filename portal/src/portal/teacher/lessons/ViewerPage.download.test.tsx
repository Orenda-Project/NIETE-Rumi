import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-zrdvmi.70 — ICT feedback sheet rows 986 (part 2) and 984: teachers cannot keep a plan to read with no internet.
 * Since 21 Nov ICT and GB plans come through the app, and its button only OPENED the plan (nothing was saved).
 * Now the plan screen's button is "Download PDF" in both layouts, and it asks for the plan's SAVE link
 * (?download=1: an attachment the phone keeps), for grades 1-5 (and the answer key) and the 6-12 / GB lane.
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

describe("Download PDF saves the plan (bd-zrdvmi.70)", () => {
  it("the words, in English and Urdu", () => {
    expect(C.downloadPdf).toBe("Download PDF");
    expect(U.downloadPdf).toBe("PDF ڈاؤن لوڈ کریں");
  });

  it("today's layout: the dock button reads Download PDF and asks for the save link (grades 1-5)", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    open(K5);
    await settle();
    const button = screen.getByTestId("share-open");
    expect(button).toHaveTextContent(C.downloadPdf);
    fireEvent.click(button);
    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/curriculum/lp/g4e8s8/pdf", { params: { kind: "lesson", download: 1 } }));
  });

  it("the 6-12 / GB lane asks its status for the save link too", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    open(G612);
    await settle();
    fireEvent.click(screen.getByTestId("share-open"));
    await waitFor(() => expect(http.get).toHaveBeenCalledWith("/lp612/status/r-gb-1", { params: { open: 1, download: 1 } }));
  });

  it("the slim row's Download asks for the save link", async () => {
    env.features = { lpViewerSlim: true };
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    open(K5);
    await settle();
    fireEvent.click(screen.getByTestId("action-strip-download"));
    await waitFor(() => expect(win).toHaveBeenCalled());
    expect(http.get).toHaveBeenCalledWith("/curriculum/lp/g4e8s8/pdf", { params: { kind: "lesson", download: 1 } });
  });
});
