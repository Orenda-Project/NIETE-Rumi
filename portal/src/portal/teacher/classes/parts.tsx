import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../ui/styles';
import { CLASSES_V2_COPY as C } from './copy';

/**
 * bd-fmf24g.8 — small pieces the My Classes and Analytics pages share: a section heading with its count
 * beside it (canvas `.label` + chip), and the loading / failed states.
 */

export function SectionHeading({ children, count, countTestId }: { children: ReactNode; count?: number; countTestId?: string }) {
  return (
    <h2 className="mx-1 mt-3 flex items-center gap-2 text-[20px] font-light leading-tight">
      {children}
      {count !== undefined && (
        <span data-testid={countTestId} className="inline-flex h-[26px] items-center rounded-full bg-[#e9ebef] px-2.5 text-[12px] font-semibold text-[#374151]">
          {count}
        </span>
      )}
    </h2>
  );
}

/** Loading, or a failed load with Try again. */
export function LoadState({ status, onRetry, label }: { status: 'idle' | 'loading' | 'error' | 'ok'; onRetry: () => void; label?: string }) {
  if (status === 'loading' || status === 'idle') {
    return (
      <div role="status" aria-label={label ?? C.loading} className="flex justify-center py-10 text-[#6b7280]">
        <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
      </div>
    );
  }
  if (status === 'error') return <LoadFailed onRetry={onRetry} />;
  return null;
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
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

/** A quiet card for "nothing here yet". */
export function EmptyCard({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-[#d1d5db] bg-white p-5 text-center text-[15px] text-[#6b7280]">{children}</p>;
}
