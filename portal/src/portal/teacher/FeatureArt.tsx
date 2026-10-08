import type { ComponentType, SVGProps } from "react";
import { BookOpen, CalendarCheck, ClipboardCheck, GraduationCap, School, Smartphone, UsersRound } from "lucide-react";

/**
 * bd-fmf24g.1 — a feature's picture on Home's tiles (canvas v28: the D2-refined
 * illustrations, 80px). The kit (bd-fmf24g.2, teacher/icons) draws the real D2 art;
 * until it lands this draws the feature's hue as a 76px circle with a stand-in glyph.
 * Swap HERE only — Home and More read nothing else.
 *
 * Each feature's colour is only ever on its own picture (DESIGN.md's colour rule).
 */
import { FEATURE_HUE, type ArtFeature } from "./hues";

export type { ArtFeature } from "./hues";

type Glyph = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const STAND_IN: Record<ArtFeature, Glyph> = {
  lessons: BookOpen,
  coaching: Smartphone,
  observations: UsersRound,
  training: GraduationCap,
  assessment: ClipboardCheck,
  attendance: CalendarCheck,
  classes: School,
};

export default function FeatureArt({ feature, size = 76 }: { feature: ArtFeature; size?: number }) {
  const Glyph = STAND_IN[feature];
  const hue = FEATURE_HUE[feature];
  return (
    <span
      aria-hidden="true"
      data-feature-art={feature}
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: hue.bg, color: hue.fg }}
    >
      <Glyph className="h-9 w-9" />
    </span>
  );
}
