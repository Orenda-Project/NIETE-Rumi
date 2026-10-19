import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-v0toag.31.1 — the older Coaching home asks "is live moves on for her?" on arrival, off Record's
// path, so Record never waits on the hop (as the new Coaching screen does, bd-v0toag.31 I-1).

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const api = vi.hoisted(() => ({
  getCoachingSessions: vi.fn(async () => ({ sessions: [] })),
  getActiveCoachingSessions: vi.fn(async () => ({ sessions: [] })),
  liveEligible: vi.fn(async () => ({ on: true })),
}));
vi.mock("../../services/api", () => ({ portal: api }));
vi.mock("../../lib/recordingSupport", () => ({ canRecordHere: vi.fn(async () => true) }));
vi.mock("../../lib/recordingStore", () => ({ latestUnsent: vi.fn(async () => null), deleteRecording: vi.fn() }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));

import CoachingHome from "./CoachingHome";
import { forgetLiveEligible, liveEligibleNow } from "../../newui/coaching/liveEligible";

beforeEach(() => { forgetLiveEligible(); vi.clearAllMocks(); });

describe("CoachingHome — live moves eligibility", () => {
  it("asks once on arrival, and Record then has the answer", async () => {
    render(<MemoryRouter><CoachingHome /></MemoryRouter>);
    await waitFor(() => expect(api.liveEligible).toHaveBeenCalledTimes(1));
    expect(await liveEligibleNow()).toBe(true);
    expect(api.liveEligible).toHaveBeenCalledTimes(1);
  });
});
