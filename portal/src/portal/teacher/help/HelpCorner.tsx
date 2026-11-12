import type { ReactNode } from 'react';
import { HelpButton } from './HelpButton';
import type { HelpFeature } from './api';
import { useHelpSwitch } from './useHelp';

/**
 * bd-ik5e8j.4 — Home's band has no header slot (its corner holds the language pill), so its "?" (Film 1, How to use
 * NIETE) sits beside the pill. Switch off: exactly the pill, as today.
 */
export function HelpCorner({ feature, children }: { feature: HelpFeature; children: ReactNode }) {
  const on = useHelpSwitch();
  if (on !== true) return <>{children}</>;
  return (
    <span className="flex items-center gap-1">
      {children}
      <HelpButton feature={feature} onDark />
    </span>
  );
}
