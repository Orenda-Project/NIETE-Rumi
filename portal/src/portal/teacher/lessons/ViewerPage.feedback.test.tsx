import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * The survey bar's place on the plan page (spec §1): at the end of HER grades 1-5 plan, once the plan has loaded, with
 * the switch on. Not for a leader, not in From the library (`pick`) or her DC plan (`fromDc`), not on her own made plan
 * (it has its own rating), not on the answer key, not on a grades 6-12 plan in this release, not before the plan loads.
 * Switch off → today's viewer: no bar and nothing asked of /lp/feedback.
 */

const viewer = vi.hoisted(() => ({ ready: true }));
const who = vi.hoisted(() => ({ leader: false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({
  default: function Viewer({ onReady }: { onReady?: () => void }) {
    useEffect(() => { if (viewer.ready) onReady?.(); }, [onReady]);
    return <div data-testid="viewer" />;
  },
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../lib/useNewUi", async (orig) => ({ ...(await orig<typeof import("../../lib/useNewUi")>()), readConfigShared: vi.fn() }));
vi.mock("./audience", () => ({ useLessonsLeader: () => who.leader }));
vi.mock("./own/OwnSections", () => ({ OwnSections: () => null }));

import api from "../../services/api";
import { readConfigShared } from "../../lib/useNewUi";
import { ViewerPage } from "./ViewerPage";
import { LESSONS_VIEWER } from "./paths";
import { FEEDBACK_COPY as F } from "./feedbackCopy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const K5 = { source: { lane: "k5", lessonId: "grade_1_english_ch1_seg3", assetKind: "lesson" }, title: "Sounds" };
let barOn: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  viewer.ready = true;
  who.leader = false;
  barOn = true;
  vi.mocked(readConfigShared).mockImplementation(async () => ({ features: { lpFeedbackBar: barOn } }) as never);
  http.get.mockImplementation(async (url: string) => {
    if (url === "/lp/feedback") return { data: { success: true, feedback: null } };
    throw Object.assign(new Error("404"), { response: { status: 404 } });
  });
  http.post.mockResolvedValue({ status: 204 });
});

const open = (state: object) => render(
  <MemoryRouter initialEntries={[{ pathname: LESSONS_VIEWER, state }]}>
    <Routes><Route path={LESSONS_VIEWER} element={<ViewerPage />} /></Routes>
  </MemoryRouter>,
);
const asked = () => http.get.mock.calls.filter(([u]) => u === "/lp/feedback");
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("the survey bar on the plan page", () => {
  it("her grades 1-5 plan, loaded, switch on: the bar, after the plan, asked for this plan", async () => {
    open({ lessonPlan: K5 });
    const bar = await screen.findByTestId("lp-feedback");
    expect(screen.getByText(F.thisPlan)).toBeTruthy();
    expect(asked()[0][1]).toEqual(expect.objectContaining({ params: { kind: "k5", ref: "grade_1_english_ch1_seg3" } }));
    expect(screen.getByTestId("viewer").compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["the switch off", () => { barOn = false; }, { lessonPlan: K5 }],
    ["the switch malformed", () => { barOn = "yes"; }, { lessonPlan: K5 }],
    ["the plan not loaded", () => { viewer.ready = false; }, { lessonPlan: K5 }],
    ["a leader", () => { who.leader = true; }, { lessonPlan: K5 }],
    ["From the library", () => {}, { lessonPlan: K5, pick: { grade: 1 } }],
    ["her DC plan", () => {}, { lessonPlan: K5, fromDc: true }],
    ["her own made plan", () => {}, { lessonPlan: K5, own: { at: "x" } }],
    ["the answer key", () => {}, { lessonPlan: { ...K5, source: { ...K5.source, assetKind: "answer_key" } } }],
    ["a grades 6-12 plan", () => {}, { lessonPlan: { source: { lane: "g612", renderId: "r1" }, title: "Cells" } }],
  ])("%s: no bar, nothing asked", async (_name, arrange, state) => {
    arrange();
    open(state);
    await waitFor(() => expect(readConfigShared).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId("lp-feedback")).toBeNull();
    expect(asked()).toHaveLength(0);
  });
});
