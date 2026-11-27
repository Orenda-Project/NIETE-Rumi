import type { LibraryPick } from "../lib/coachingSend";
import { planFileKindOf, type LessonPlanSource } from "../lib/lessonPlanOpen";

/**
 * bd-kijmb8 (queue #318) — the lesson plan attached to a visit, per visit, in memory: Check and send reads and writes it,
 * and the recording page shows it ("Lesson plan") or offers "Attach lesson plan" while nothing is attached. Same shape as
 * the plan Check and send always held; `lessonId` is the library lesson a recent or picked plan names, to open it.
 */
export type HeldPlan =
  | { kind: "library"; pick: LibraryPick; title: string; sub: string; lessonId?: string | null }
  | { kind: "file"; file: File; title: string; sub: string };

const held = new Map<string, HeldPlan>();

export const getHeldPlan = (visitId: string): HeldPlan | null => held.get(visitId) || null;
export function setHeldPlan(visitId: string, plan: HeldPlan | null): void {
  if (plan) held.set(visitId, plan); else held.delete(visitId);
}
export const clearHeldPlan = (visitId: string): void => { held.delete(visitId); };

/** What the viewer is opened with for this plan, or null when it cannot be opened over the page (a written 6-12 lesson). */
export function viewSourceOf(plan: HeldPlan): LessonPlanSource | null {
  if (plan.kind === "file") return { lane: "local", file: plan.file, fileKind: planFileKindOf(plan.file) };
  const id = "lessonId" in plan.pick ? plan.pick.lessonId : plan.lessonId;
  return id ? { lane: "k5", lessonId: id, assetKind: "lesson" } : null;
}
