import { useContext, type ReactNode } from 'react';
import { AuthContext } from '../../hooks/authContext';
import { isCoachV2For, useCoachV2 } from '../../coach/useCoachV2';
import { useNewUi } from '../../lib/useNewUi';

/**
 * Where the phone's bottom tab bar ends, as `bottom-*` classes for things that must
 * sit just above it: classic 64px, the new UI 80px + safe area, the coach v2 frame
 * 78px + safe area. No tab bar from md up.
 */
export function useAboveTabBar(): { bar: string; toast: string } {
  const shared = useContext(AuthContext);
  const user = shared && !shared.loading ? shared.user : null;
  const phone = user?.phoneNumber || null;
  const v2 = isCoachV2For(user, useCoachV2(phone, !!user));
  const newUi = useNewUi(phone, !!user) === true && !v2;
  if (v2) return { bar: 'bottom-[calc(78px+env(safe-area-inset-bottom))] md:bottom-0', toast: 'bottom-[calc(90px+env(safe-area-inset-bottom))] md:bottom-4' };
  if (newUi) return { bar: 'bottom-[calc(80px+env(safe-area-inset-bottom))] md:bottom-0', toast: 'bottom-[calc(92px+env(safe-area-inset-bottom))] md:bottom-4' };
  return { bar: 'bottom-16 md:bottom-0', toast: 'bottom-20 md:bottom-4' };
}

/** The screen's main action(s), stuck to the bottom of the view, above the tab bar. */
export default function AssessActions({ children }: { children: ReactNode }) {
  const { bar } = useAboveTabBar();
  return (
    <div data-testid="assess-actions"
      className={`sticky ${bar} z-20 space-y-1 border-t border-slate-200 bg-white px-1 pt-3 pb-3 md:pb-[max(12px,env(safe-area-inset-bottom))]`}>
      {children}
    </div>
  );
}
