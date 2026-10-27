import { ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../i18n";
import { FOCUS } from "../ui/styles";
import { HOME_CARD } from "./copy";
import type { TapKind } from "./api";

/**
 * The Home's "Quizzes" tile (portal_teacher_home_quiz_tile, default OFF): the 2nd tile of the feature grid, right after
 * Lesson plans (COS ruling 27 Oct 2026, the operator's "figure out the best place for it": Lesson plans has the widest
 * 7-day reach, and a quiz follows a lesson). It is the same kind of tile as its neighbours, on each Home's own design: a
 * FeatureTile-shaped tile on the card's Home, a feature row on the new look. One tap opens the teacher's quiz home
 * (GET /me/home's signed `quizHome`, a page load through onGo, which logs `quiz_tile` first). The callers draw it only
 * when /me/home said `quizTile` AND gave a quiz home; it is never a coach's (their quizHome is null).
 */
export type QuizTileProps = {
  quizHome: string;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
};

/** The card Home's tile: FeatureTile's own shell (size, border, shadow, the 80px art slot), the quiz glyph in a green badge. */
export function QuizFeatureTile({ quizHome, onGo, className, wide = false }: QuizTileProps & { wide?: boolean }) {
  const H = useCopy(HOME_CARD);
  return (
    <button
      type="button"
      data-testid="tile-quiz"
      onClick={() => onGo("quiz_tile", quizHome)}
      className={cn(
        "flex flex-col items-center justify-center gap-3.5 rounded-[20px] border border-[#e5e7eb] bg-white px-2.5 py-[18px] text-center shadow-[0_1px_3px_rgba(16,24,40,0.08)]",
        "transition-colors hover:bg-[#f9fafb] motion-reduce:transition-none",
        FOCUS,
        wide ? "col-span-2 min-h-[132px]" : "min-h-[176px]",
        className,
      )}
    >
      <span aria-hidden="true" className="flex h-20 w-20 items-center justify-center rounded-full bg-[#eaf6ef] text-[#2f7a52]">
        <ClipboardCheck size={40} />
      </span>
      <span className="text-[18px] font-semibold leading-tight">{H.quizTile}</span>
    </button>
  );
}

/** The new look's row: the look's own row (white, an icon well tinted green like Lesson plans, the word). */
export function QuizRow({ quizHome, onGo, className }: QuizTileProps) {
  const H = useCopy(HOME_CARD);
  return (
    <button
      type="button"
      data-testid="tile-quiz"
      data-row="quiz"
      onClick={() => onGo("quiz_tile", quizHome)}
      className={cn(
        "flex min-h-[52px] items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-white px-2 py-1.5 text-start max-[343px]:gap-2 max-[343px]:px-1.5",
        FOCUS,
        className,
      )}
    >
      <span
        data-well
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#e7f5ed] text-[#2e7d57] max-[343px]:h-8 max-[343px]:w-8"
      >
        <ClipboardCheck size={20} />
      </span>
      <span data-label className="min-w-0 text-[14px] font-semibold text-[#333748] [overflow-wrap:anywhere] hyphens-auto max-[343px]:text-[13px]">
        {H.quizTile}
      </span>
    </button>
  );
}
