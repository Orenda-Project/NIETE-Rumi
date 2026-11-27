import { useCallback, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useCopy } from '../teacher/i18n';
import LessonPlanViewer from './LessonPlanViewer';
import { LESSON_PLAN_SHEET_COPY } from './lessonPlanSheetCopy';
import type { LessonPlanView } from '../lib/lessonPlanOpen';
import { registerOverlay } from '../lib/overlayBack';

/**
 * bd-kijmb8 (queue #318) — a lesson plan over the page it was opened from.
 *
 * A full-screen layer with ITS OWN history entry: the phone's Back, the in-app browser's back and ‹ all close it and land
 * on the same page, same scroll, same recorder. The page underneath stays mounted, so a live recording's clock and audio
 * carry on ("Recording continues" shows in the viewer while `recording`).
 *
 * The coach's recorder keeps a "Finish recording?" guard entry (lib/useRecordingBackGuard). This entry sits ABOVE it, and
 * the guard ignores a Back while this sheet is registered (lib/overlayBack), so the first Back closes the plan and the second asks.
 */
const SHEET_FLAG = 'lessonPlanSheet';

const flagged = (): boolean => {
  try { return (window.history.state as Record<string, unknown> | null)?.[SHEET_FLAG] === true; } catch { return false; }
};

export function LessonPlanSheet({ view, recording, onClose }: { view: LessonPlanView; recording: boolean; onClose: () => void }) {
  const C = useCopy(LESSON_PLAN_SHEET_COPY);
  const { toast } = useToast();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    const release = registerOverlay();
    let pushed = false;
    try {
      const state = (window.history.state as Record<string, unknown> | null) || {};
      window.history.pushState({ ...state, [SHEET_FLAG]: true }, '');
      pushed = true;
    } catch { /* no history here (an embedded view): ‹ still closes it */ }
    const onPop = () => {
      if (done.current) return;
      done.current = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      release();
      // Closed by code (not by Back): take its entry off, so Back afterwards goes where it always did.
      if (pushed && !done.current && flagged()) {
        done.current = true;
        try { window.history.back(); } catch { /* nothing to take off */ }
      }
    };
  }, []);

  const close = useCallback(() => {
    if (flagged()) { try { window.history.back(); return; } catch { /* fall through */ } }
    if (!done.current) { done.current = true; closeRef.current(); }
  }, []);

  return (
    <div data-testid="lesson-plan-sheet" role="dialog" aria-modal="true" aria-label={view.title || C.lessonPlan}
      className="fixed inset-0 z-[70] overflow-y-auto bg-[#f7f8fa] px-4 pb-6 pt-2">
      <LessonPlanViewer
        view={{ ...view, title: view.title || C.lessonPlan }}
        recording={recording}
        chrome="own"
        onClose={close}
        onNotReady={() => { toast({ title: C.notReady, variant: 'destructive' }); close(); }}
      />
    </div>
  );
}

export default LessonPlanSheet;
