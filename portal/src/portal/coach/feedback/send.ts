import { Capacitor } from "@capacitor/core";
import { portal } from "../../services/api";
import type { VoiceClip } from "../../lib/voiceAnswer";
import type { FeedbackCopy } from "./copy";

/**
 * bd-x1tl95 — Send feedback's one send: the voice note and each screenshot go straight to R2 first (presign → PUT), then
 * ONE POST names their keys (dashboard routes/app-feedback.routes.js → the bot's app-feedback.service). The bot checks
 * every key is hers and arrived; nothing is kept if the POST is refused.
 */

export const TOPICS = ["problem", "idea", "other"] as const;
export type Topic = (typeof TOPICS)[number];

// The bot's feedback_photo kind (portal-coaching.service KINDS): a phone screenshot is PNG or JPG; WebP from some phones.
export const MAX_SCREENSHOTS = 3;
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export type FeedbackDraft = { topic: Topic; text: string; clip: VoiceClip | null; shots: File[] };

/** Why a picked file cannot be a screenshot, or null when it can. */
export function checkScreenshot(f: File): "not_picture" | "too_large" | null {
  if (!SCREENSHOT_TYPES.includes(f.type)) return "not_picture";
  if (f.size > MAX_SCREENSHOT_BYTES) return "too_large";
  return null;
}

async function upload(filename: string, blob: Blob, kind: "feedback_audio" | "feedback_photo"): Promise<string> {
  const signed = await portal.presignFeedbackUpload({ filename, sizeBytes: blob.size, kind });
  await portal.uploadToR2(signed.uploadUrl, blob, signed.contentType);
  return signed.key;
}

export async function sendFeedback(d: FeedbackDraft): Promise<{ feedbackId: string }> {
  const audioKey = d.clip ? await upload(`voice${d.clip.ext}`, d.clip.blob, "feedback_audio") : undefined;
  const photoKeys: string[] = [];
  for (const f of d.shots) photoKeys.push(await upload(f.name, f, "feedback_photo"));
  const text = d.text.trim() || undefined;
  // Which browser she is in is read by the server from the request; the app only says when it IS the Android app.
  const context = { surface: "coach_more", ...(Capacitor.isNativePlatform() ? { native: true } : {}) };
  return portal.sendFeedback({ topic: d.topic, text, audioKey, photoKeys, context });
}

/** The line a failed send shows: the day's limit by name, "No internet" only when offline, else try again. */
export function failureText(e: unknown, C: FeedbackCopy): string {
  const reason = (e as { response?: { data?: { reason?: string } } } | null)?.response?.data?.reason;
  if (reason === "too_many") return C.tooMany;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return C.noInternet;
  return C.couldNotSend;
}
