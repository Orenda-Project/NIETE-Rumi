import { cn } from "@/lib/utils";
import { TEACHER_FRAME } from "../../copy";
import { useCopy } from "../../i18n";
import { FeatureMotionProvider, type AnyFeature } from "../../icons";
import { teacherPath } from "../../routes";
import { FeatureTile } from "../../ui";
import type { HomeTileKey, TapKind } from "../api";
import { QuizFeatureTile } from "../QuizTile";

/** True when `order` holds every tile exactly once. */
function isPermutation(order: readonly HomeTileKey[], tiles: readonly { key: HomeTileKey }[]): boolean {
  if (order.length !== tiles.length || new Set(order).size !== order.length) return false;
  return tiles.every(({ key }) => order.includes(key));
}

/**
 * The Home look's features: the kit's FeatureTile per feature in its compact size (104px, the feature's 44px D2 art, all
 * moving on the page's one shared timer, 14px words), THREE per row, so all nine fit the first screen of a phone. The look
 * once drew its own 52px rows with lucide line icons here; the operator brought the tiles back (30 Oct 2026, mockup v6
 * option B), so the look and the card build draw the same tile.
 * The grid is `[display:grid]`, never `.grid` (index.css mirrors `.grid` to LTR under Urdu).
 * @param tiles the features and their art, in Home's fixed order
 * @param order the server's order; used only when it is a whole permutation of `tiles`
 */
export function FeatureTiles({ tiles, order, className, quiz }: {
  tiles: readonly { key: HomeTileKey; art: AnyFeature }[];
  order?: HomeTileKey[] | null;
  className?: string;
  /** The Quizzes tile (portal_teacher_home_quiz_tile): drawn right after Lesson plans; absent → today's eight tiles. */
  quiz?: { quizHome: string; onGo: (kind: TapKind, href: string) => void } | null;
}) {
  const C = useCopy(TEACHER_FRAME);
  const art = new Map(tiles.map((t) => [t.key, t.art]));
  const keys = order && isPermutation(order, tiles) ? order : tiles.map((t) => t.key);
  // the tiles in drawing order: the features, with the Quizzes tile after Lesson plans (2nd when Lesson plans leads)
  const cells: (HomeTileKey | "quiz")[] = [...keys];
  if (quiz) cells.splice(Math.max(cells.indexOf("lessons"), 0) + 1, 0, "quiz");
  return (
    <FeatureMotionProvider>
      <nav aria-label={C.home.features} data-testid="feature-tiles" className={cn("[display:grid] grid-cols-3 gap-2.5", className)}>
        {cells.map((key) => {
          if (key === "quiz") return quiz ? <QuizFeatureTile key="quiz" quizHome={quiz.quizHome} onGo={quiz.onGo} compact /> : null;
          return <FeatureTile key={key} feature={art.get(key)!} label={C.home.tiles[key]} to={teacherPath(key)} compact />;
        })}
      </nav>
    </FeatureMotionProvider>
  );
}
