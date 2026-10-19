import type { LibraryPick } from '../lib/coachingSend';
import type { Plan as FlowPlan } from '../newui/coaching/useSendFlow';

/**
 * bd-v0toag.31.1 — live moves on the older record screen, which every prod teacher still gets.
 * Its plan has a `sub` line where the new screen's has chips; the live-moves hook only reads the
 * lesson id, so a library plan maps across and a file plan gives it nothing. The plan she picked
 * before Record is held here, off the page, so leaving and coming back mid-lesson keeps it.
 */

export type LegacyPlan =
  | { kind: 'library'; pick: LibraryPick; title: string; sub: string }
  | { kind: 'file'; file: File; title: string; sub: string };

export function asFlowPlan(plan: LegacyPlan | null): FlowPlan | null {
  if (!plan || plan.kind !== 'library') return null;
  return { kind: 'library', pick: plan.pick, title: plan.title, chips: [] };
}

let held: LegacyPlan | null = null;
export function holdPlan(plan: LegacyPlan | null): void { held = plan; }
export function heldPlan(): LegacyPlan | null { return held; }
