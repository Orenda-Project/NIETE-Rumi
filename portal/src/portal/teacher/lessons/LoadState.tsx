import { cn } from '@/lib/utils';
import { FOCUS } from '../ui/styles';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import { SkeletonList } from '../../components/Skeleton';

/**
 * bd-fmf24g.3 — the Lesson Plans list pages' shared states: loading, a failed load (with Try again),
 * or nothing to show.
 */
/** Loading, a failed load (with Try again), or nothing to show — the states every list page shares. */
export function LoadState({ status, empty, onRetry }: { status: 'idle' | 'loading' | 'error' | 'ok'; empty: boolean; onRetry: () => void }) {
  const C = useCopy(LESSONS);
  if (status === 'loading') {
    return (
      // bd-fxk3t8 — rows of placeholders where the list will be, instead of a spinner.
      <SkeletonList rows={3} label={C.title} className="py-2" />
    );
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center">
        <p className="text-[16px] font-semibold text-[#1d2025]">{C.loadFailed}</p>
        <button
          type="button"
          onClick={onRetry}
          className={cn('min-h-[56px] rounded-2xl bg-[#33374a] px-6 text-[16px] font-semibold text-white', FOCUS)}
        >
          {C.tryAgain}
        </button>
      </div>
    );
  }
  if (status === 'ok' && empty) {
    return <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.nothingHere}</p>;
  }
  return null;
}
