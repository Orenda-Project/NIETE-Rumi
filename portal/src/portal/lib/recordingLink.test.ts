import { describe, it, expect, beforeEach } from "vitest";
import { linkOf, linkKey, sameObservation, isUnlinked, beatLink } from "./recordingLink";
import { rememberRecording } from "./coachObserve";

/**
 * bd-ma9jiy (queue #262; the operator 26 Nov ~15:10) — what a kept recording belongs to, and the ONE test for "this
 * observation's recording": the same kind and the same id (a coach's visit, a debrief's observation, a teacher's DC
 * attempt). No id = unlinked: never resumed, never sent as another observation's.
 */
const meta = (over: Record<string, unknown> = {}) => ({ id: "rec-1", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-11-26T05:00:00Z", elapsedMs: 60_000, finished: false, ...over });

beforeEach(() => { window.localStorage.clear(); });

describe("linkOf / sameObservation", () => {
  it("the row's own link first", () => {
    const l = { kind: "obs" as const, visitId: "visit-0001-aaaa", teacherExtId: "923001110001" };
    expect(linkOf(meta({ link: l }))).toEqual(l);
    expect(linkKey(l)).toBe("obs:visit-0001-aaaa");
  });

  it("a coach copy kept before 26 Nov: its visit from the phone's teacher list (rememberRecording)", () => {
    rememberRecording("rec-1", { teacherExtId: "923001110001", schoolExtId: null, teacherName: "Ayesha", kind: "obs", visitId: "visit-0001-aaaa" });
    expect(linkKey(linkOf(meta()))).toBe("obs:visit-0001-aaaa");
    expect(isUnlinked(meta())).toBe(false);
  });

  it("a coach copy with no visit (kept before 25 Nov), or a teacher's DC take with no attempt: unlinked", () => {
    rememberRecording("rec-1", { teacherExtId: "923001110001", schoolExtId: null, teacherName: "Ayesha" });
    expect(isUnlinked(meta())).toBe(true);
    expect(isUnlinked(meta({ id: "rec-2" }))).toBe(true);
  });

  it("the 62-teacher case: an old stopped lesson and today's new one are two observations", () => {
    const old = meta({ id: "rec-old", finished: true, link: { kind: "dc", attemptId: "att-old-0001" } });
    expect(sameObservation(old, { kind: "dc", attemptId: "att-new-0001" })).toBe(false);
    expect(sameObservation(old, { kind: "dc", attemptId: "att-old-0001" })).toBe(true);
    // an unlinked one matches nothing, ever
    expect(sameObservation(meta({ id: "rec-x" }), { kind: "dc", attemptId: "att-new-0001" })).toBe(false);
  });

  it("two visits of the same teacher are two observations; a debrief is never the lesson", () => {
    const v1 = meta({ link: { kind: "obs", visitId: "visit-0001-aaaa", teacherExtId: "923001110001" } });
    expect(sameObservation(v1, { kind: "obs", visitId: "visit-0002-bbbb" })).toBe(false);
    expect(sameObservation(v1, { kind: "dbrf", observationId: "visit-0001-aaaa" })).toBe(false);
  });

  it("beatLink: the recorder's heartbeat context is the link (plus the class, kept on the phone only)", () => {
    expect(beatLink({ kind: "dc", attemptId: "att-0001-aaaa" }, { grade: 4, subject: "Science" })).toEqual({ kind: "dc", attemptId: "att-0001-aaaa", grade: 4, subject: "Science" });
    expect(beatLink({ kind: "obs", visitId: "visit-0001-aaaa", teacherExtId: "9230" })).toEqual({ kind: "obs", visitId: "visit-0001-aaaa", teacherExtId: "9230" });
  });
});
