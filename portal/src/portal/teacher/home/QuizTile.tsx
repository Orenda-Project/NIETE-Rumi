import { cn } from "@/lib/utils";
import { useCopy } from "../i18n";
import { FeatureArt } from "../icons";
import { tileArtSize, tileShell, tileWords } from "../ui";
import { HOME_CARD } from "./copy";
import type { TapKind } from "./api";

/**
 * The Home's "Quizzes" tile (portal_teacher_home_quiz_tile, default OFF): the 2nd tile of the feature grid, right after
 * Lesson plans (COS ruling 27 Oct 2026, the operator's "figure out the best place for it": Lesson plans has the widest
 * 7-day reach, and a quiz follows a lesson). It is the same kind of tile as its neighbours: a
 * FeatureTile-shaped tile on both Homes (the card build's and the new look's). One tap opens the teacher's quiz home
 * (GET /me/home's signed `quizHome`, a page load through onGo, which logs `quiz_tile` first). The callers draw it only
 * when /me/home said `quizTile` AND gave a quiz home; it is never a coach's (their quizHome is null).
 */
export type QuizTileProps = {
  quizHome: string;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
};

/** The Quizzes tile: the kit tile's own shell (ui/FeatureTile tileShell), its moving quiz picture, on both Homes. */
export function QuizFeatureTile({ quizHome, onGo, className, wide = false, compact = false }: QuizTileProps & { wide?: boolean; compact?: boolean }) {
  const H = useCopy(HOME_CARD);
  return (
    <button
      type="button"
      data-testid="tile-quiz"
      onClick={() => onGo("quiz_tile", quizHome)}
      className={cn(tileShell({ wide, compact }), className)}
    >
      <FeatureArt feature="quiz" size={tileArtSize(compact)} motion />
      <span className={tileWords(compact)}>{H.quizTile}</span>
    </button>
  );
}
