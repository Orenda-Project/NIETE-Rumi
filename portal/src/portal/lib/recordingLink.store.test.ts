// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { createRecording, appendChunk, listKept, readKept, latestUnsent, __resetForTests } from "./recordingStore";

/**
 * bd-ma9jiy (queue #262; the operator 26 Nov ~15:10, after #292: 62 teachers recorded a new lesson onto an old kept file):
 * "on the user's device we should note which observation is the one that's being recorded. So they can also store 2 at
 * a time as well." Every recording kept on the phone carries, in its own row, what it belongs to (its link), and any
 * number of them live side by side.
 */
beforeEach(async () => { await __resetForTests(); });

const piece = () => new Blob([new Uint8Array([1, 2, 3])]);

describe("the phone's store keeps each recording's link with it", () => {
  it("createRecording stores the link; listKept and readKept give it back", async () => {
    const link = { kind: "dc" as const, attemptId: "att-0001-aaaa", grade: 4, subject: "General Science" };
    await createRecording({ id: "rec-a", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-26T05:00:00Z", link });
    await appendChunk("rec-a", 0, piece(), 1000);
    expect((await listKept())[0].meta.link).toEqual(link);
    expect((await readKept("rec-a"))?.meta.link).toEqual(link);
  });

  it("two recordings for two observations live side by side, never merged", async () => {
    await createRecording({ id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-25T05:00:00Z", link: { kind: "dc", attemptId: "att-old-0001" } });
    await appendChunk("rec-old", 0, piece(), 1000);
    await createRecording({ id: "rec-new", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-26T05:00:00Z", link: { kind: "dc", attemptId: "att-new-0001" } });
    await appendChunk("rec-new", 0, piece(), 1000);
    const all = await listKept();
    expect(all.map((k) => k.meta.id).sort()).toEqual(["rec-new", "rec-old"]);
    const mine = await latestUnsent((m) => m.link?.attemptId === "att-old-0001");
    expect(mine?.meta.id).toBe("rec-old");
    expect(mine?.nextSeq).toBe(1); // its own pieces only
  });
});
