import { useToast } from '@/hooks/use-toast';
import { useCopy } from '../teacher/i18n';
import LessonPlanViewer from './LessonPlanViewer';
import { LESSON_PLAN_SHEET_COPY } from './lessonPlanSheetCopy';
import type { LessonPlanView } from '../lib/lessonPlanOpen';
import { useOverlayEntry } from '../lib/useOverlayEntry';

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
export function LessonPlanSheet({ view, recording, onClose }: { view: LessonPlanView; recording: boolean; onClose: () => void }) {
  const C = useCopy(LESSON_PLAN_SHEET_COPY);
  const { toast } = useToast();
  const close = useOverlayEntry(onClose);

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
