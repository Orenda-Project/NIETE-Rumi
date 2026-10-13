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

/**
 * bd-fmf24g.66 — what the coach's "Their own plan" picker takes: the files the plan reader can read. `.doc` (old binary
 * Word) is left out on purpose: the server accepts it but the reader only opens `.docx`, so a `.doc` would upload and
 * then come back "Couldn't read". Size is the server's `lesson_plan` cap.
 */
export const PLAN_FILE_EXTENSIONS = [".pdf", ".docx", ".jpg", ".jpeg", ".png"];
export const PLAN_MAX_BYTES = UPLOAD_RULES.lesson_plan.maxBytes;
export const PLAN_MAX_MB = PLAN_MAX_BYTES / MB;

export type PlanKind = "pdf" | "word" | "photo";

/** The kind a plan file is shown as ("PDF", "Word", "Photo"); null for a type the picker does not take. */
export function planKindOf(name: string): PlanKind | null {
  const ext = extensionOf(name);
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "word";
  if ([".jpg", ".jpeg", ".png"].includes(ext)) return "photo";
  return null;
}

export function checkPlanFile(file: File): FileProblem {
  if (!PLAN_FILE_EXTENSIONS.includes(extensionOf(file.name))) return "wrong_type";
  if (file.size > PLAN_MAX_BYTES) return "too_large";
  return null;
}

/** The WhatsApp photo step's cap (MAX_COACHING_PHOTOS). */
export const MAX_PHOTOS = 3;

/**
 * bd-fmf24g.76 — what the teacher v2 Digital Coaching page takes: ten (the operator, 12 Oct). The WhatsApp step, the older
 * pages and the coach's observation keep MAX_PHOTOS. The server's cap for this path is MAX_DC_PHOTOS in
 * bot/shared/services/coaching/portal-coaching.service.js: keep the two in step.
 */
export const DC_MAX_PHOTOS = 10;

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

/** A recording's length in words: "less than a minute", never seconds rounded up. */
export function minutesText(ms: number): string {
  if (ms < 60_000) return 'less than a minute';
  const m = Math.round(ms / 60_000);
  return `${m} minute${m === 1 ? '' : 's'}`;
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
