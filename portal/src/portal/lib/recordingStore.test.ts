// @vitest-environment node
// Node's own Blob: IndexedDB (fake-indexeddb here, the browser in real life)
// stores it as a Blob. jsdom's Blob does not survive structuredClone.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  createRecording, appendChunk, markFinished, latestUnsent, deleteRecording, __resetForTests,
} from "./recordingStore";

function readText(blob: Blob): Promise<string> {
  return blob.text();
}


// bd-5rz1v — a 40-minute recording is never only in memory.
//
// Every few seconds the recorder hands over a chunk and it is written to
// IndexedDB on the phone. If the page reloads, the app is killed, or the upload
// fails, the lesson is still there and can be sent — "your recording is safe on
// this phone" is a promise the page makes, and this is what keeps it.


beforeEach(async () => {
  await __resetForTests();
});

describe("recordingStore", () => {
  it("returns nothing when there is no unsent recording", async () => {
    expect(await latestUnsent()).toBeNull();
  });

  it("keeps every chunk, in order, with how long it had been recording", async () => {
    await createRecording({ id: "r1", mimeType: "audio/webm;codecs=opus", ext: ".webm", startedAt: "2026-10-02T10:00:00Z" });
    await appendChunk("r1", 0, new Blob(["aa"]), 5_000);
    await appendChunk("r1", 1, new Blob(["bb"]), 10_000);
    await appendChunk("r1", 2, new Blob(["cc"]), 15_000);

    const got = await latestUnsent();
    expect(got).not.toBeNull();
    expect(got!.meta).toMatchObject({ id: "r1", ext: ".webm", elapsedMs: 15_000, finished: false });
    expect(await readText(got!.blob)).toBe("aabbcc");
    expect(got!.blob.type).toBe("audio/webm;codecs=opus");
  });

  it("marks a recording finished without losing it", async () => {
    await createRecording({ id: "r1", mimeType: "audio/mp4", ext: ".m4a", startedAt: "2026-10-02T10:00:00Z" });
    await appendChunk("r1", 0, new Blob(["aa"]), 4_000);
    await markFinished("r1", 4_200);

    const got = await latestUnsent();
    expect(got!.meta).toMatchObject({ finished: true, elapsedMs: 4_200 });
  });

  it("offers the most recent recording when there are several", async () => {
    await createRecording({ id: "old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-01T10:00:00Z" });
    await appendChunk("old", 0, new Blob(["o"]), 1_000);
    await createRecording({ id: "new", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T10:00:00Z" });
    await appendChunk("new", 0, new Blob(["n"]), 1_000);

    expect((await latestUnsent())!.meta.id).toBe("new");
  });

  it("ignores a recording that never captured anything", async () => {
    await createRecording({ id: "empty", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T10:00:00Z" });
    expect(await latestUnsent()).toBeNull();
  });

  it("deletes a recording and its chunks once it has been sent", async () => {
    await createRecording({ id: "r1", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T10:00:00Z" });
    await appendChunk("r1", 0, new Blob(["aa"]), 5_000);
    await deleteRecording("r1");
    expect(await latestUnsent()).toBeNull();
  });
});
