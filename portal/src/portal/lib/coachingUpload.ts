/**
 * bd-7hyj7 — what the browser checks before a teacher's files are uploaded.
 *
 * The bot is the authority (bot/shared/services/coaching/portal-coaching.service.js
 * KINDS) and re-checks every key, type and size; these rules exist so she is
 * told "that is not a recording" BEFORE waiting for a 40 MB upload, not after.
 * Keep them in step with KINDS — a type allowed here but not there uploads
 * nothing and fails at sign time, which is the safe direction to drift in.
 */

export type UploadKind = "audio" | "lesson_plan" | "photo";

const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<UploadKind, { extensions: string[]; maxBytes: number }> = {
  audio: {
    extensions: [".m4a", ".mp4", ".aac", ".mp3", ".ogg", ".opus", ".wav", ".amr", ".3gp", ".webm"],
    maxBytes: 300 * MB,
  },
  lesson_plan: { extensions: [".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png"], maxBytes: 25 * MB },
  photo: { extensions: [".jpg", ".jpeg", ".png"], maxBytes: 15 * MB },
};

/** The WhatsApp photo step's cap (MAX_COACHING_PHOTOS). */
export const MAX_PHOTOS = 3;

/** Under this the WhatsApp path treats audio as a voice note, not a lesson. */
export const SHORT_RECORDING_SECONDS = 600;

export function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

/** For an <input accept="…">: the extensions this kind takes. */
export function acceptFor(kind: UploadKind): string {
  return UPLOAD_RULES[kind].extensions.join(",");
}

export type FileProblem = "wrong_type" | "too_large" | null;

export function checkFile(file: File, kind: UploadKind): FileProblem {
  const rule = UPLOAD_RULES[kind];
  if (!rule.extensions.includes(extensionOf(file.name))) return "wrong_type";
  if (file.size > rule.maxBytes) return "too_large";
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The recording's length in seconds, read by the browser from the file's own
 * metadata — used ONLY to warn about a short recording. Resolves null when the
 * browser cannot read it (some .amr/.3gp files), which shows no warning; the
 * server measures the real duration with ffprobe either way.
 */
export function readAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    let url = "";
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const audio = document.createElement("audio");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    audio.src = url;
  });
}
