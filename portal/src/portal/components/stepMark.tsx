import { useEffect, useRef, useState, type RefObject } from 'react';
import { locateStep, type StepMark, type TextDocLike } from '../lib/planSteps';

/**
 * v10 coaching test (bd-v0toag.8, PR3) — the step her thing to try belongs to, on the plan the viewer draws
 * (components/LessonPlanViewer): its heading outlined, and the tap on the strip that takes her there.
 *
 * The heading is read from the PDF's text (lib/planSteps) after the plan is open, in its own turn, so the
 * first page is never held up. Not found is nothing: no outline, no move. The page moves only when she taps
 * (each tap is a new `jump`), never by itself (IAB: no auto-advance), and without the glide when her phone
 * asks for reduced motion. The outline is drawn over the canvas and never takes a tap.
 */

/** Room above the heading when she is taken to it, so its outline shows whole. */
const ABOVE = 24;

/** Where `step`'s heading is in the drawn plan, once found; null until then, and when there is none. */
export function useStepMark(doc: TextDocLike | null, step: number | null | undefined): StepMark | null {
  const [found, setFound] = useState<{ doc: TextDocLike; step: number; mark: StepMark | null } | null>(null);
  useEffect(() => {
    if (!doc || step == null) return undefined;
    let live = true;
    const t = setTimeout(() => {
      void locateStep(doc, step).then((mark) => { if (live) setFound({ doc, step, mark }); });
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [doc, step]);
  return found && found.doc === doc && found.step === step ? found.mark : null;
}

/** Scroll the window to the mark's heading inside `root` (its pages carry data-page). False when it is not there. */
export function jumpToMark(root: HTMLElement | null, mark: StepMark): boolean {
  const page = root?.querySelector<HTMLElement>(`[data-page="${mark.page}"]`);
  if (!page) return false;
  const box = page.getBoundingClientRect();
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: box.top + window.scrollY + mark.top * box.height - ABOVE, behavior: reduce ? 'auto' : 'smooth' });
  return true;
}

/** Take her to the mark once per tap (a new `jump`); a tap before the heading is found moves when it is. */
export function useStepJump(root: RefObject<HTMLElement | null>, mark: StepMark | null, jump: number | undefined) {
  const done = useRef(0);
  useEffect(() => {
    if (!jump || !mark || done.current === jump) return;
    if (jumpToMark(root.current, mark)) done.current = jump;
  }, [root, mark, jump]);
}

/** The outline over the heading's band (the plan's own heading, in the strip's amber). */
export function StepOutline({ mark }: { mark: Pick<StepMark, 'top' | 'height'> }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-[2%] rounded-md border-[3px] border-[#f5b400] bg-[#fff4cc]/25"
      style={{ top: `calc(${mark.top * 100}% - 6px)`, height: `calc(${mark.height * 100}% + 12px)` }}
    />
  );
}
