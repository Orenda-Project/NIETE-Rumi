/**
 * bd-5rz1v — can "Record now" work on this device?
 *
 * A browser needs getUserMedia and MediaRecorder. The NIETE app is a Capacitor
 * WebView: its WebView refuses the microphone unless the APK declares
 * RECORD_AUDIO, which only builds from MIC_APP_BUILD do (bd-q4g7s,
 * portal/android). The web bundle reaches older installs too, so it must not
 * show them a button that can never record — they keep "Choose a recording".
 */

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/**
 * The first app build whose manifest declares the microphone (android/app/build.gradle).
 * Not 1214/1215: a 1215 bundle was built for Play on 2026-09-10 from code with no
 * RECORD_AUDIO, so an install of it must not be offered "Record now" (bd-q4g7s.1).
 */
export const MIC_APP_BUILD = 1216;

export type RecordingType = { mimeType: string; ext: ".webm" | ".ogg" | ".m4a" };

/**
 * In order of preference. WebM/Opus is what Chrome and the Android WebView
 * record; MP4 audio is Safari's. Each extension is one the bot signs uploads for
 * (portal-coaching.service KINDS.audio).
 */
const CANDIDATES: RecordingType[] = [
  { mimeType: "audio/webm;codecs=opus", ext: ".webm" },
  { mimeType: "audio/webm", ext: ".webm" },
  { mimeType: "audio/ogg;codecs=opus", ext: ".ogg" },
  { mimeType: "audio/mp4", ext: ".m4a" },
];

export function pickRecordingType(
  MR: typeof MediaRecorder | undefined = typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
): RecordingType | null {
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  return CANDIDATES.find((c) => MR.isTypeSupported(c.mimeType)) || null;
}

type Env = {
  isNative: () => boolean;
  appBuild: () => Promise<number | null>;
  hasGetUserMedia: () => boolean;
  MediaRecorder: typeof MediaRecorder | undefined;
};

function defaultEnv(): Env {
  return {
    isNative: () => Capacitor.isNativePlatform(),
    appBuild: async () => {
      const info = await App.getInfo();
      const n = Number(info.build);
      return Number.isFinite(n) ? n : null;
    },
    hasGetUserMedia: () => typeof navigator !== "undefined"
      && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function",
    MediaRecorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
  };
}

export async function canRecordHere(env: Env = defaultEnv()): Promise<boolean> {
  if (!env.hasGetUserMedia() || !pickRecordingType(env.MediaRecorder)) return false;
  if (!env.isNative()) return true;
  try {
    const build = await env.appBuild();
    return build != null && build >= MIC_APP_BUILD;
  } catch {
    return false;
  }
}
