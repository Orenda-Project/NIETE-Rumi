import { ChevronRight, PencilLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { CHEVRON, FOCUS } from '../../ui/styles';
import { useCopy } from '../../i18n';
import { OWN } from './copy';
import { changeUrl, type ChangeAt } from './change';

/**
 * bd-snkn32.15 — on her own plan in the viewer: "Change this plan (N left)", or, with both used, how to start fresh.
 * Shown only when the plan was opened from its waiting screen (Preparing knows it is hers and how many are left).
 */
export function ChangeEntry({ at }: { at: ChangeAt }) {
  const C = useCopy(OWN);
  if (at.left <= 0) {
    return <p data-testid="own-change-used" className="text-[15px] text-[#4b5563]">{C.usedBoth}</p>;
  }
  return (
    <Link
      to={changeUrl(at)}
      data-testid="own-change-entry"
      className={cn('flex min-h-[56px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] font-semibold text-[#33374a]', FOCUS)}
    >
      <PencilLine className="h-5 w-5" aria-hidden="true" />
      <span className="flex-1">{C.changeThisPlan(at.left)}</span>
      <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}
