import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-ma9jiy.5 (queue #262; the operator 26 Nov ~22:20: "It should work similar to the main coaching recorder."): her
 * spoken reflection answer, cut mid-way (the page closed, the phone locked), comes back PAUSED on the report — what she
 * said is kept, with its time; Resume carries on in the same recording, Remove throws it away. The recorder itself
 * (kept against this session, resumed into the same file) is lib/voiceAnswer.shared.test.ts; this is the screen.
 */
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({
  getCoachingProgress: vi.fn(),
  getCoachingSession: vi.fn(),
  submitCoachingReflection: vi.fn(),
  presignCoachingUpload: vi.fn(),
  uploadToR2: vi.fn(),
  submitCoachingVoiceReflection: vi.fn(),
  getCoachingReportFile: vi.fn(),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock("./navigate", () => ({ goTo: vi.fn() }));
const voice = vi.hoisted(() => ({
  opts: [] as unknown[],
  hook: {
    available: true, state: "paused", clip: null, elapsedMs: 20_000, empty: false,
    start: vi.fn(async () => {}), stop: vi.fn(async () => {}), discard: vi.fn(), markEmpty: vi.fn(),
  },
}));
vi.mock("../../lib/voiceAnswer", () => ({
  useVoiceAnswer: (o: unknown) => { voice.opts.push(o); return voice.hook; },
  sendVoiceAnswer: vi.fn(),
}));

import "../routes";
import api from "../../services/api";
import { ReportPage } from "./ReportPage";
import { COACHING_REPORT } from "./paths";
import { COACHING_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const ID = "0b4e8f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  vi.clearAllMocks();
  voice.opts = [];
  http.get.mockResolvedValue({ data: { success: true, points: [] } });
  portal.getCoachingProgress.mockResolvedValue({ id: ID, status: "conducting_conversation", stage: "reflection", source: "portal",
    reflection: { questionNumber: 1, question: "Which children answered?" } });
});

const open = () => render(
  <MemoryRouter initialEntries={[COACHING_REPORT.replace(":id", ID)]}>
    <Routes><Route path={COACHING_REPORT} element={<ReportPage />} /></Routes>
  </MemoryRouter>,
);

describe("a reflection answer cut mid-way (bd-ma9jiy.5)", () => {
  it("the recorder keeps it against THIS session", async () => {
    open();
    await screen.findByText("Which children answered?");
    expect(voice.opts).toContainEqual({ sessionId: ID });
  });

  it("comes back Paused with its time; Resume carries on, Remove throws it away", async () => {
    open();
    expect(await screen.findByText(C.paused)).toBeTruthy();
    expect(screen.getByText("0:20")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: C.resume }));
    expect(voice.hook.start).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: C.removeRecording }));
    expect(voice.hook.discard).toHaveBeenCalled();
  });
});
