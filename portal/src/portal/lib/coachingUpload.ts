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

/**
 * bd-fgj73x.7 — the shortest recording Digital Coaching takes: 15 minutes, the WhatsApp bot's own line
 * (bot/shared/config/classroom-audio.config.js CLASSROOM_AUDIO_THRESHOLD). A few seconds recorded by
 * accident got a full report (operator, 16 Oct): Recording says the minimum up front, and a shorter one
 * cannot be submitted. A file whose length cannot be read is not held back.
 */
export const DC_MIN_SECONDS = 900;

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
 * An uploaded recording's length in seconds, read by the browser from the file's
 * own metadata. Digital Coaching holds back a file under DC_MIN_SECONDS with it
 * (bd-fgj73x.7: no Submit). Resolves null when the browser cannot tell: a format
 * it cannot play (some .amr/.3gp, some .ogg/.opus on iPhones), a file whose header
 * carries no length (duration Infinity), an error, or no answer within 8 seconds.
 * A null is NOT held back, so a real lesson in such a format can still be sent;
 * the server measures the true duration with ffprobe after upload.
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

/* ── bd-i0u6n2 — the recording slot of Digital Coaching: audio only ─────────────────────────────────────────────
 * The name ending alone decided "is this a recording?". Two gaps (operator, 20 Oct):
 *   - a real recording whose name has no ending (some pickers, WhatsApp's in-app browser) was "Not a recording";
 *   - a video with an audio ending (.mp4/.webm/.3gp) went through, and a lesson-length video failed as "too large".
 * Now the type the phone gives a file counts too, and a video is refused with its own line. The pipeline sends the
 * bytes to Soniox as they are (it reads the format from the content), so an audio file under another name is fine;
 * it is uploaded under a name with an ending the server takes (KINDS.audio in portal-coaching.service.js). */

/** The phone's audio types the pipeline has transcribed, and the ending each is uploaded under. */
const AUDIO_TYPE_EXT: Record<string, string> = {
  "audio/mpeg": ".mp3", "audio/mp3": ".mp3",
  "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/m4a": ".m4a",
  "audio/aac": ".aac", "audio/x-aac": ".aac",
  "audio/ogg": ".ogg", "audio/opus": ".opus",
  "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/vnd.wave": ".wav",
  "audio/amr": ".amr", "audio/3gpp": ".3gp", "audio/webm": ".webm",
};

/** Endings that are video only; .mp4/.webm/.3gp can be either, so they are opened to see. */
const VIDEO_ONLY_EXT = [".mov", ".mkv", ".avi", ".wmv", ".flv", ".m4v", ".mpeg", ".mpg", ".ts", ".3g2"];
const EITHER_EXT = [".mp4", ".webm", ".3gp"];

/** The name to upload an audio file under (one with an ending the server takes); null when it is not audio. */
export function audioUploadName(file: File): string | null {
  const ext = extensionOf(file.name);
  if (UPLOAD_RULES.audio.extensions.includes(ext)) return file.name;
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  const mapped = AUDIO_TYPE_EXT[type];
  if (!mapped) return null;
  const stem = ext ? file.name.slice(0, -ext.length) : file.name;
  return `${stem.trim() || "recording"}${mapped}`;
}

/**
 * Does this file have a picture? The browser opens it as a video and reads its size: true (a picture), false (sound
 * only), null (the browser cannot read it, or no answer within 6 seconds). Kept on an object so a test can stand in.
 */
export const mediaProbe = {
  hasVideo(file: File): Promise<boolean | null> {
    return new Promise((resolve) => {
      let url = "";
      try {
        url = URL.createObjectURL(file);
      } catch {
        resolve(null);
        return;
      }
      const video = document.createElement("video");
      const done = (value: boolean | null) => {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(value);
      };
      const timer = window.setTimeout(() => done(null), 6000);
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => done(video.videoWidth > 0 || video.videoHeight > 0);
      video.onerror = () => done(null);
      video.src = url;
    });
  },
};

export type AudioFileProblem = FileProblem | "video";

/**
 * The recording slot's check: a video → "video" (before the size, so a long video is not "too large"); not audio →
 * "wrong_type"; over the cap → "too_large"; else the name to upload it under.
 */
export async function checkAudioFile(file: File): Promise<{ problem: AudioFileProblem; filename?: string }> {
  const ext = extensionOf(file.name);
  const type = (file.type || "").toLowerCase();
  const name = audioUploadName(file);
  // A file the phone marks as audio is not opened; an .mp4 Android marks video/mp4 (it does so for every .mp4) is.
  const maybeVideo = !type.startsWith("audio/")
    && (type.startsWith("video/") || VIDEO_ONLY_EXT.includes(ext) || EITHER_EXT.includes(ext));
  if (maybeVideo) {
    const picture = await mediaProbe.hasVideo(file);
    // A picture is a video. One the browser cannot read is a video only when it is not an audio format by name.
    if (picture === true || (picture === null && !name)) return { problem: "video" };
  }
  let upload = name;
  if (!upload) {
    // bd-qbbikm: the name and the type say nothing (an ending like .MP3EG has no type either) — read the first bytes.
    const sniffed = await sniffAudioExt(file);
    if (!sniffed) return { problem: "wrong_type" };
    if (!maybeVideo && SNIFF_CONTAINERS.includes(sniffed) && (await mediaProbe.hasVideo(file)) === true) return { problem: "video" };
    const stem = ext ? file.name.slice(0, -ext.length) : file.name;
    upload = `${stem.trim() || "recording"}${sniffed}`;
  }
  if (file.size > UPLOAD_RULES.audio.maxBytes) return { problem: "too_large" };
  return { problem: null, filename: upload };
}

/** Containers that can hold a picture: found by their bytes, they are opened to see before they are taken. */
const SNIFF_CONTAINERS = [".mp4", ".webm", ".3gp"];

/** The first `n` bytes of a file (empty when the browser cannot read it). */
async function headOf(file: Blob, n: number): Promise<Uint8Array> {
  try {
    const part = file.slice(0, n);
    if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
      r.onerror = () => resolve(new Uint8Array(0));
      r.readAsArrayBuffer(part);
    });
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * bd-qbbikm — the audio format a file's first bytes say it is, as an ending the server takes, or null. Only the
 * formats the pipeline has transcribed; anything else (a photo, a PDF, unknown bytes) is null.
 */
export async function sniffAudioExt(file: Blob): Promise<string | null> {
  const b = await headOf(file, 16);
  const at = (i: number, text: string) => text.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length < 4) return null;
  if (at(0, "ID3")) return ".mp3";
  if (at(0, "OggS")) return ".ogg";
  if (at(0, "RIFF") && at(8, "WAVE")) return ".wav";
  if (at(0, "#!AMR")) return ".amr";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return ".webm";
  if (at(4, "ftyp")) {
    if (at(8, "M4A")) return ".m4a";
    if (at(8, "3gp") || at(8, "3g2")) return ".3gp";
    return ".mp4";
  }
  // An MPEG frame with no tag: 11 sync bits. ADTS (AAC) has layer 00; MP3 does not.
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? ".aac" : ".mp3";
  return null;
}
