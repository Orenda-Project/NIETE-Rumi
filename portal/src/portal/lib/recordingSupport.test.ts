import { describe, it, expect } from "vitest";
import { canRecordHere, pickRecordingType, MIC_APP_BUILD } from "./recordingSupport";

// bd-5rz1v — "Record now" is offered only where it can work.
//
// A browser needs getUserMedia and MediaRecorder. The NIETE app is a WebView,
// and its WebView refuses the microphone unless the APK declares RECORD_AUDIO —
// which only builds from MIC_APP_BUILD do (bd-q4g7s). An older install would
// show a button that can never record, so it is hidden there and the teacher
// still has "Choose a recording".

function MR(supported: string[]) {
  return { isTypeSupported: (t: string) => supported.includes(t) } as unknown as typeof MediaRecorder;
}

const browser = (over: Partial<Parameters<typeof canRecordHere>[0]> = {}) => ({
  isNative: () => false,
  appBuild: async () => null,
  hasGetUserMedia: () => true,
  MediaRecorder: MR(["audio/webm;codecs=opus"]),
  ...over,
});

describe("pickRecordingType", () => {
  it("prefers WebM/Opus — what Chrome and the Android WebView record", () => {
    expect(pickRecordingType(MR(["audio/webm;codecs=opus", "audio/mp4"]))).toEqual({ mimeType: "audio/webm;codecs=opus", ext: ".webm" });
  });

  it("falls back to MP4 audio (Safari), saved as .m4a", () => {
    expect(pickRecordingType(MR(["audio/mp4"]))).toEqual({ mimeType: "audio/mp4", ext: ".m4a" });
  });

  it("is null when nothing usable is supported, or MediaRecorder is missing", () => {
    expect(pickRecordingType(MR([]))).toBeNull();
    expect(pickRecordingType(undefined)).toBeNull();
  });
});

describe("canRecordHere", () => {
  it("a browser with getUserMedia and MediaRecorder can record", async () => {
    expect(await canRecordHere(browser())).toBe(true);
  });

  it("a browser without getUserMedia cannot", async () => {
    expect(await canRecordHere(browser({ hasGetUserMedia: () => false }))).toBe(false);
  });

  it("a browser without MediaRecorder cannot", async () => {
    expect(await canRecordHere(browser({ MediaRecorder: undefined }))).toBe(false);
  });

  it(`the app can record from build ${MIC_APP_BUILD}, the first that declares the microphone`, async () => {
    expect(await canRecordHere(browser({ isNative: () => true, appBuild: async () => MIC_APP_BUILD }))).toBe(true);
    expect(await canRecordHere(browser({ isNative: () => true, appBuild: async () => MIC_APP_BUILD + 3 }))).toBe(true);
  });

  it("an older app install cannot, even though its WebView has the APIs", async () => {
    expect(await canRecordHere(browser({ isNative: () => true, appBuild: async () => MIC_APP_BUILD - 1 }))).toBe(false);
  });

  it("an app whose build cannot be read is treated as old", async () => {
    expect(await canRecordHere(browser({ isNative: () => true, appBuild: async () => null }))).toBe(false);
    expect(await canRecordHere(browser({
      isNative: () => true,
      appBuild: async () => { throw new Error("no plugin"); },
    }))).toBe(false);
  });
});
