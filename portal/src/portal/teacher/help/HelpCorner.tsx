import type { ReactNode } from 'react';
import { HelpButton } from './HelpButton';
import type { HelpFeature } from './api';
import { useHelpSwitch } from './useHelp';

/**
 * bd-ik5e8j.4 — Home's band has no header slot (its corner holds the language pill), so its "?" (Film 1, How to use
 * NIETE) sits beside the pill. Switch off: exactly the pill, as today.
 *
 * bd-sil83f (queue #269) — on Home it is the "How to use ?" pill, not the bare "?" (the operator, 24 Nov ~19:20: "at least
 * on the home page ... to make it more obvious that the videos are there"). `children` may be a function of whether the
 * pill is drawn, so the language pill beside it can be compact: at 360 px the Urdu row (the mark, NIETE, "English", the
 * pill) has no room for the language pill's glyph too.
 */
export function HelpCorner({ feature, children }: { feature: HelpFeature; children: ReactNode | ((help: boolean) => ReactNode) }) {
  const on = useHelpSwitch();
  const draw = (help: boolean) => (typeof children === 'function' ? children(help) : children);
  if (on !== true) return <>{draw(false)}</>;
  return (
    <span className="flex items-center gap-1">
      {draw(true)}
      <HelpButton feature={feature} pill onDark />
    </span>
  );
}
