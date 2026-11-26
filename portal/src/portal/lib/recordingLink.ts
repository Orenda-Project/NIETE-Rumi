import type { RecordingLink, StoredRecording } from "./recordingStore";
export { beatLink } from "./recordingBeat";
import { recordingTeacher } from "./coachObserve";

/**
 * bd-ma9jiy (queue #262; the operator 26 Nov ~15:10, after #292: 62 teachers recorded today's lesson onto an old kept
 * file): "on the user's device we should note which observation is the one that's being recorded. So they can also store
 * 2 at a time as well."
 *
 * Every recording kept on the phone says what it belongs to — its LINK: a coach's or principal's visit (the lesson), the
 * observation a debrief talk is for, or a teacher's Digital Coaching attempt (made when she pressed Start). The ONE rule
 * every screen uses: a kept recording is reopened, continued or sent only for the observation it is linked to
 * (sameObservation: the same kind and the same id). Any number of them live side by side, each under its own observation.
 *
 * Where the link comes from:
 *   the row's own `link`          written when the recorder made the file (LessonRecorder, from its heartbeat context)
 *   the coach's teacher list      a coach copy saved before this (rememberRecording: its visit or its observation)
 *   nothing                       a teacher's take, or a coach copy with no visit, saved before 25/26 Nov: UNLINKED —
 *                                 never reopened, never sent as another observation's (offered on its own)
 */

/** What a kept recording belongs to: its own link, else the coach's teacher list for an older copy, else null. */
export function linkOf(meta: Pick<StoredRecording, "id" | "link">): RecordingLink | null {
  if (meta.link && meta.link.kind) return meta.link;
  const who = recordingTeacher(meta.id);
  if (!who) return null;
  return {
    kind: who.kind === "dbrf" ? "dbrf" : "obs",
    visitId: who.visitId ?? null,
    observationId: who.observationId ?? null,
    teacherExtId: who.teacherExtId || null,
    teacherName: who.teacherName || null,
  };
}

/** "obs:<visit>", "dbrf:<observation>", "dc:<attempt>"; null when it names no observation (unlinked). */
export function linkKey(link: RecordingLink | null | undefined): string | null {
  if (!link) return null;
  const id = link.kind === "obs" ? link.visitId : link.kind === "dbrf" ? link.observationId : link.kind === "dc" ? link.attemptId : null;
  return id ? `${link.kind}:${id}` : null;
}

export function isUnlinked(meta: Pick<StoredRecording, "id" | "link">): boolean {
  return linkKey(linkOf(meta)) === null;
}

/** THE test: is this kept recording the one for that observation? Unlinked matches nothing, ever. */
export function sameObservation(meta: Pick<StoredRecording, "id" | "link">, target: RecordingLink): boolean {
  const mine = linkKey(linkOf(meta));
  return mine !== null && mine === linkKey(target);
}

/** A new teacher attempt's id (Start). */
export function newAttemptId(): string {
  try {
    return `att-${crypto.randomUUID()}`;
  } catch {
    return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
