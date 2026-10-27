import { ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../i18n";
import { FOCUS } from "../ui/styles";
import { HOME_CARD } from "./copy";
import type { TapKind } from "./api";

/**
 * The Home's "Quizzes" tile (portal_teacher_home_quiz_tile, default OFF): one full-width row under the eight features,
 * so they still fill four rows. One tap opens the teacher's quiz home (GET /me/home's signed `quizHome`, a page load
 * through onGo, which logs `quiz_tile` first): make a quiz, send it to the class, see who played. The caller draws it
 * only when /me/home said `quizTile` AND gave a quiz home; it is never a coach's (their quizHome is null).
 * The row is the look's own (a white row, a green icon well, the feature's word) on both Homes.
 */
export function QuizTile({ quizHome, onGo, className }: { quizHome: string; onGo: (kind: TapKind, href: string) => void; className?: string }) {
  const H = useCopy(HOME_CARD);
  return (
    <button
      type="button"
      data-testid="tile-quiz"
      onClick={() => onGo("quiz_tile", quizHome)}
      className={cn(
        "flex min-h-[52px] w-full items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-white px-2 py-1.5 text-start",
        FOCUS,
        className,
      )}
    >
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#e7f5ed] text-[#2e7d57]">
        <ClipboardCheck size={20} />
      </span>
      <span className="min-w-0 text-[14px] font-semibold text-[#333748] [overflow-wrap:anywhere]">{H.quizTile}</span>
    </button>
  );
}
