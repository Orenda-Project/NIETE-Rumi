import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

/**
 * v10 coaching test (bd-v0toag.8, PR3) — the plan page hands the strip's step to the viewer: the step the
 * moment the thing is read (so its heading is outlined), and each tap that opens the strip as a new jump (so
 * she is taken there). No thing, or a thing with no step: the viewer gets no highlight, as today.
 */

const seen = vi.hoisted(() => ({ highlight: [] as unknown[] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../components/LessonPlanViewer", () => ({
  default: ({ highlight }: { highlight?: unknown }) => { seen.highlight.push(highlight); return <div data-testid="viewer" />; },
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { ViewerPage } from "./ViewerPage";
import { LESSONS_VIEWER } from "./paths";
import { LESSONS_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const VIEW = { source: { lane: "k5", lessonId: "g1e8s6", assetKind: "lesson" }, title: "Sounds" };
let thing: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  seen.highlight = [];
  thing = { text: "Ask one child to explain to a neighbour.", tag: "hlp_peer_talk", step: { name: "We Do", index: 3 } };
  http.get.mockImplementation(async (url: string) => {
    if (url === "/teacher/thing-to-try") return { data: { success: true, thing } };
    throw Object.assign(new Error("404"), { response: { status: 404 } });
  });
  http.post.mockResolvedValue({ status: 204 });
});

const KEY = { source: { lane: "k5", lessonId: "g1e8s6", assetKind: "answer_key" }, title: "Sounds" };
function GoToKey() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(LESSONS_VIEWER, { state: { lessonPlan: KEY } })}>key</button>;
}
const open = () => render(
  <MemoryRouter initialEntries={[{ pathname: LESSONS_VIEWER, state: { lessonPlan: VIEW } }]}>
    <Routes><Route path={LESSONS_VIEWER} element={<><ViewerPage /><GoToKey /></>} /></Routes>
  </MemoryRouter>,
);
const last = () => seen.highlight[seen.highlight.length - 1];

describe("ViewerPage, the step", () => {
  it("the viewer is told the step once the thing is read, with no jump", async () => {
    open();
    await waitFor(() => expect(last()).toEqual({ step: 3, jump: 0 }));
  });

  it("each tap that opens the strip is a new jump", async () => {
    open();
    const strip = await screen.findByRole("button", { name: new RegExp(C.thingToTry) });
    fireEvent.click(strip);
    expect(last()).toEqual({ step: 3, jump: 1 });
    fireEvent.click(strip);
    expect(last()).toEqual({ step: 3, jump: 1 });
    fireEvent.click(strip);
    expect(last()).toEqual({ step: 3, jump: 2 });
  });

  it.each([
    ["no thing", null],
    ["a thing with no step", { text: "Praise effort.", tag: null, step: null }],
  ])("%s: no highlight", async (_l, t) => {
    thing = t;
    open();
    await waitFor(() => expect(http.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 5));
    expect(seen.highlight.every((h) => h === undefined)).toBe(true);
  });

  it("another plan opened from this page (the answer key) starts with no highlight", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.thingToTry) }));
    expect(last()).toEqual({ step: 3, jump: 1 });
    fireEvent.click(screen.getByRole("button", { name: "key" }));
    await waitFor(() => expect(last()).toBeUndefined());
  });
});
