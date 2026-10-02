// @vitest-environment node
// Node's Blob survives IndexedDB's structured clone (fake-indexeddb here, the
// browser in real life); jsdom's does not — the recordingStore.test.ts reason.
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Store from "./recordings";
import { flushPending, uploadItem } from "./uploader";

// bd-s1oo0.7 — a block's recording (and the maths strip photo) stays on the
// phone until it has reached R2 AND the bot has attached it. A dropped
// connection loses nothing; the next flush sends it.

const SESSION = "s-1";

function readText(b: Blob): Promise<string> {
  return b.text();
}

async function recordAudio(id: string, block: "urdu" | "english" | "maths", parts = ["a", "b"]) {
  await Store.createRecording({ id, mimeType: "audio/webm;codecs=opus", ext: ".webm", startedAt: new Date().toISOString() });
  for (let i = 0; i < parts.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Store.appendChunk(id, i, new Blob([parts[i]], { type: "audio/webm" }), (i + 1) * 5000);
  }
  await Store.markFinished(id, parts.length * 5000);
  await Store.tagRecording(id, { sessionId: SESSION, block, kind: "audio", timing: { timedStartMs: 0, timedEndMs: 60_000 } });
}

function makeApi() {
  return {
    presignBlockUpload: vi.fn(async (_s: string, a: { block: string; kind: string; contentType: string }) => ({
      key: `child-test/sandbox/sch/${SESSION}/${a.kind === "photo" ? "maths-strip.jpg" : `${a.block}.webm`}`,
      uploadUrl: "https://r2.example/put", contentType: a.contentType.split(";")[0],
    })),
    uploadToR2: vi.fn(async () => undefined),
    registerBlockMedia: vi.fn(async () => ({ scoring: "started" })),
  };
}

beforeEach(async () => {
  await Store.__resetForTests();
});

describe("uploadItem", () => {
  it("presigns, PUTs the assembled recording, registers it with the timing, then deletes the phone copy", async () => {
    await recordAudio("r1", "urdu");
    const [item] = await Store.listPending(SESSION);
    const api = makeApi();
    const out = await uploadItem(item, api);
    expect(out).toEqual({ ok: true, scoring: "started" });
    expect(api.presignBlockUpload).toHaveBeenCalledWith(SESSION, expect.objectContaining({ block: "urdu", kind: "audio", contentType: "audio/webm;codecs=opus" }));
    const putBlob = api.uploadToR2.mock.calls[0][1] as Blob;
    expect(await readText(putBlob)).toBe("ab");
    expect(api.registerBlockMedia).toHaveBeenCalledWith(SESSION, {
      block: "urdu", audioKey: `child-test/sandbox/sch/${SESSION}/urdu.webm`, timing: { timedStartMs: 0, timedEndMs: 60_000 },
    });
    expect(await Store.listPending(SESSION)).toEqual([]);
  });

  it("a network failure keeps the recording on the phone", async () => {
    await recordAudio("r1", "english");
    const [item] = await Store.listPending(SESSION);
    const api = makeApi();
    api.uploadToR2.mockRejectedValueOnce(new Error("Network Error"));
    const out = await uploadItem(item, api);
    expect(out).toEqual({ ok: false, error: "network" });
    expect((await Store.listPending(SESSION)).map((p) => p.meta.id)).toEqual(["r1"]);
  });

  it("a refusal (400) keeps it too, with the reason", async () => {
    await recordAudio("r1", "urdu");
    const [item] = await Store.listPending(SESSION);
    const api = makeApi();
    api.registerBlockMedia.mockRejectedValueOnce({ response: { status: 400, data: { reason: "not_your_upload" } } });
    const out = await uploadItem(item, api);
    expect(out).toEqual({ ok: false, error: "refused", reason: "not_your_upload" });
    expect(await Store.listPending(SESSION)).toHaveLength(1);
  });

  it("the photo goes up as the maths strip", async () => {
    await Store.savePhoto({ id: "p1", sessionId: SESSION, blob: new Blob(["jpg"], { type: "image/jpeg" }) });
    const [item] = await Store.listPending(SESSION);
    const api = makeApi();
    await uploadItem(item, api);
    expect(api.presignBlockUpload).toHaveBeenCalledWith(SESSION, expect.objectContaining({ block: "maths", kind: "photo", contentType: "image/jpeg" }));
    expect(api.registerBlockMedia).toHaveBeenCalledWith(SESSION, { block: "maths", photoKey: `child-test/sandbox/sch/${SESSION}/maths-strip.jpg` });
  });
});

describe("flushPending", () => {
  it("sends every finished, tagged item and reports each", async () => {
    await recordAudio("r1", "urdu");
    await recordAudio("r2", "maths");
    // an untagged, unfinished recording (still being made) is left alone
    await Store.createRecording({ id: "live", mimeType: "audio/webm", ext: ".webm", startedAt: new Date().toISOString() });
    const api = makeApi();
    const out = await flushPending(api);
    expect(out.map((r) => [r.id, r.ok])).toEqual(expect.arrayContaining([["r1", true], ["r2", true]]));
    expect(out).toHaveLength(2);
    expect(api.uploadToR2).toHaveBeenCalledTimes(2);
  });

  it("re-recording replaces the earlier take for the same block before it is sent", async () => {
    await recordAudio("old", "urdu", ["old"]);
    await recordAudio("new", "urdu", ["new"]);
    const pending = await Store.listPending(SESSION);
    expect(pending.map((p) => p.meta.id)).toEqual(["new"]);
  });
});
