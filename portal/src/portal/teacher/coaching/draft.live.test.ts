import { describe, it, expect, beforeEach } from "vitest";
import type { LiveMovesRecord } from "../../services/api";
import { clearDraft, holdDraft, peekDraft, type Draft } from "./draft";

/**
 * bd-v0toag.31.3 — the live record rides in the draft from Stop to Submit. The page re-holds the draft on every change
 * (it does not know about it), so the record is kept while it still belongs to what is held: the same recording and
 * the same lesson. Another recording, an uploaded file or another plan drops it.
 */

const LIVE = { lessonId: "L1", liveId: "rec-1", moves: [], taps: [] } as unknown as LiveMovesRecord;
const audio = (recordingId: string | null) =>
  ({ blob: new Blob(["a"]), filename: "l.webm", durationMs: 1, recordingId, source: "recorded", size: 1, startedAt: null }) as Draft["audio"];
const plan = (lessonId: string) => ({ kind: "library" as const, pick: { lessonId }, title: "t", chips: [] });

beforeEach(() => clearDraft());

describe("the live record in the draft", () => {
  it("is kept when the page re-holds the same recording and lesson", () => {
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: LIVE });
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [new File(["p"], "p.jpg")] });
    expect(peekDraft()?.live).toBe(LIVE);
  });

  it("is dropped for another recording or an uploaded file", () => {
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: LIVE });
    holdDraft({ audio: audio("rec-2"), plan: plan("L1"), photos: [] });
    expect(peekDraft()?.live).toBeNull();
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: LIVE });
    holdDraft({ audio: audio(null), plan: plan("L1"), photos: [] });
    expect(peekDraft()?.live).toBeNull();
  });

  it("is dropped when the plan changes or goes", () => {
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: LIVE });
    holdDraft({ audio: audio("rec-1"), plan: plan("L2"), photos: [] });
    expect(peekDraft()?.live).toBeNull();
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: LIVE });
    holdDraft({ audio: audio("rec-1"), plan: null, photos: [] });
    expect(peekDraft()?.live).toBeNull();
  });

  it("is dropped, not a crash, when the draft has no audio yet", () => {
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: LIVE });
    expect(() => holdDraft({ audio: null, plan: plan("L1"), photos: [] })).not.toThrow();
    expect(peekDraft()?.live).toBeNull();
  });

  it("an explicit null clears it", () => {
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: LIVE });
    holdDraft({ audio: audio("rec-1"), plan: plan("L1"), photos: [], live: null });
    expect(peekDraft()?.live).toBeNull();
  });
});
