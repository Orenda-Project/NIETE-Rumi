import type { LucideIcon } from 'lucide-react';
import { BookOpen, ClipboardList, GraduationCap, House, Mic, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import nieteMark from '@/assets/niete-mark.png';

/**
 * bd-5rz1v.19 — a feature's own icon, and THE ONLY PLACE a feature colour is drawn.
 *
 * The colour rule (DESIGN.md): a feature's colour appears only on that feature's icon — the
 * tile on its main page's indigo band, its tiles on Home, and the start of a breadcrumb.
 * Everything else is neutral grey. checks/style.test.tsx fails the build if any other
 * new-UI file writes a `nu-f-*` class, so a screen that wants a feature colour has to come
 * through here.
 */

export type Feature = 'home' | 'lessonPlans' | 'training' | 'assessment' | 'coaching' | 'attendance';

const FEATURE_GLYPH: Record<Feature, LucideIcon> = {
  home: House,
  lessonPlans: BookOpen,
  assessment: ClipboardList,
  training: GraduationCap,
  coaching: Mic,
  attendance: Users,
};

/** On light: the breadcrumb and Home's tiles — the feature's hue (FEATURE_ICON.onLight). */
const ON_LIGHT: Record<Feature, string> = {
  home: 'text-nu-f-home-crumb',
  lessonPlans: 'text-nu-f-lesson-plans-crumb',
  training: 'text-nu-f-training-crumb',
  assessment: 'text-nu-f-assessment-crumb',
  coaching: 'text-nu-f-coaching-crumb',
  attendance: 'text-nu-f-my-classes-crumb',
};

/** On the indigo band: the feature's LIGHT tint (FEATURE_ICON.onIndigo); white until one is set. */
const ON_BAND: Record<Feature, string> = {
  home: 'text-white',
  lessonPlans: 'text-nu-f-lesson-plans',
  training: 'text-nu-f-training',
  assessment: 'text-nu-f-assessment',
  coaching: 'text-white',
  attendance: 'text-white',
};

export function FeatureIcon({ feature, on = 'light', className }: { feature: Feature; on?: 'light' | 'band'; className?: string }) {
  const Glyph = FEATURE_GLYPH[feature];
  return <Glyph className={cn('shrink-0', on === 'band' ? ON_BAND[feature] : ON_LIGHT[feature], className)} aria-hidden="true" />;
}

/**
 * The 44px soft-white tile on a main page's band (52px on a desktop), holding the feature's
 * icon in its light tint. Home shows the NIETE mark instead. Decorative: the page's title says
 * where she is.
 */
export function HeadingTile({ feature }: { feature: Feature }) {
  const size = 'h-11 w-11 shrink-0 rounded-[13px] md:h-[52px] md:w-[52px]';
  if (feature === 'home') {
    return <img data-testid="newui-heading-tile" src={nieteMark} alt="" className={cn(size, 'object-cover')} />;
  }
  return (
    <span data-testid="newui-heading-tile" aria-hidden="true" className={cn(size, 'flex items-center justify-center bg-nu-f-tile')}>
      <FeatureIcon feature={feature} on="band" className="h-[26px] w-[26px]" />
    </span>
  );
}
