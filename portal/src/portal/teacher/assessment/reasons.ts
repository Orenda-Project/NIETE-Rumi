import type { AssessmentV2Copy } from './copy';
import { stepWhy, type Why, type PageCheck, type Picks, type Step } from './model';

/**
 * bd-fmf24g.34 — a reason in the teacher's words: model.ts says WHAT is wrong (stepWhy, checkPages), copy.ts holds
 * the words in English and Urdu. One function per kind, so a step's dock and its fields say the same thing.
 */
export function whyText(w: Why, C: AssessmentV2Copy): string {
  switch (w.code) {
    case 'class': return C.why.class;
    case 'chapters': return C.why.chapters;
    case 'ranges': return C.why.ranges;
    case 'none': return C.why.none;
    case 'count': return C.why.count(w.max);
    case 'typesMax': return C.why.typesMax(w.max);
    case 'marks': return C.why.marks(w.max);
    case 'marksLow': return C.why.marksLow(w.total);
    case 'earlier': return C.why.earlier(C.steps[w.step]);
    case 'generating': return C.why.generating;
    case 'scopeOrFde': return C.why.scopeOrFde;
    case 'topics': return C.why.topics;
  }
}

/** The step's reason as words, or null when she may go on: what the dock shows above its button. */
export function stepReason(
  step: Step, p: Picks, max: number, C: AssessmentV2Copy, opts?: { busy?: boolean; offerFde?: boolean },
): string | null {
  const w = stepWhy(step, p, max, opts);
  return w ? whyText(w, C) : null;
}

/** What the page boxes say right under them; null once the range is fine. */
export function pagesMessage(check: PageCheck, C: AssessmentV2Copy): { text: string; tone: 'hint' | 'error' } | null {
  if (check.ok) return null;
  switch (check.why) {
    case 'empty': return { text: C.why.typePages, tone: 'hint' };
    case 'zero': return { text: C.why.pagesStart, tone: 'error' };
    case 'beyond': return { text: C.why.pagesBeyond(check.last), tone: 'error' };
    case 'order': return { text: C.why.pagesOrder(check.from, check.to), tone: 'error' };
  }
}
