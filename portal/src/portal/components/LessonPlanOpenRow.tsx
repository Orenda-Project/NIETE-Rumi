import { ChevronRight, FileText } from 'lucide-react';
import { useCopy } from '../teacher/i18n';
import { LESSON_PLAN_SHEET_COPY } from './lessonPlanSheetCopy';

/**
 * bd-kijmb8 (queue #318) — "Lesson plan · NIETE plan / Teacher's own plan · Open": the one button that opens the plan
 * linked to a recording or an observation. 56px+ target; `compact` is the chip inside a recording card.
 */
export function LessonPlanOpenRow({ source, title, onOpen, compact = false }: {
  source: 'library' | 'own'; title?: string | null; onOpen: () => void; compact?: boolean;
}) {
  const C = useCopy(LESSON_PLAN_SHEET_COPY);
  const kind = source === 'library' ? C.nietePlan : C.ownPlan;
  if (compact) {
    return (
      <button type="button" data-testid="lesson-plan-open" onClick={onOpen}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border-[1.5px] border-[#c7cad6] bg-white px-4 text-[15px] font-semibold text-[#33374a]">
        <FileText className="h-[18px] w-[18px]" aria-hidden="true" />{C.lessonPlan}
      </button>
    );
  }
  return (
    <button type="button" data-testid="lesson-plan-open" onClick={onOpen}
      className="flex min-h-[64px] w-full items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white py-2.5 pe-3.5 ps-3 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]" aria-hidden="true">
        <FileText className="h-[22px] w-[22px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-[16px] font-semibold leading-[1.3]">{C.lessonPlan}</span>
        <span dir="auto" className="line-clamp-1 text-[13px] leading-[1.3] text-[#6b7280]">{[kind, title].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[15px] font-semibold text-[#33374a]">
        {C.open}<ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </span>
    </button>
  );
}
