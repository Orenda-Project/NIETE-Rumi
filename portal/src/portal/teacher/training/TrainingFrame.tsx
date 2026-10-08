import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TrainingFrameContext, type TrainingFrameProps } from '../../newui/training/frame';
import TeacherPage from '../TeacherPage';
import { FOCUS } from '../ui/styles';
import { TRAINING_V2_COPY as C } from './copy';
import { SkeletonList } from '../../components/Skeleton';

/**
 * bd-fmf24g.5 — every teacher v2 Training page is the shared v2 page (TeacherPage, bd-fmf24g.1) with the
 * Training tile beside the title: Back, the breadcrumb over the title (both wrap), information under the
 * header (`context`, the teaching level on the main page), then the column.
 */
export function TrainingPageV2({
  crumb, title, backTo, onBack, right, context, dock, children,
}: TrainingFrameProps & { context?: ReactNode; dock?: ReactNode }) {
  return (
    <TeacherPage feature="training" crumb={crumb} title={title} backTo={backTo} onBack={onBack} action={right} chips={context} dock={dock}>
      {children}
    </TeacherPage>
  );
}

/**
 * The training screens reused from the new UI (a course, a part, the quick check, the exams, certificates,
 * My grades) build their own page through newui/training/frame's TrainingInner; mounted under this, they
 * get the v2 page instead of the new UI's bar. Their logic, reads and words are untouched.
 */
export function InV2Frame({ children }: { children: ReactNode }) {
  return <TrainingFrameContext.Provider value={TrainingPageV2}>{children}</TrainingFrameContext.Provider>;
}

/** Loading, or a failed read with Try again. */
export function LoadState({ loading, failed, onRetry }: { loading: boolean; failed: boolean; onRetry: () => void }) {
  if (loading) {
    return (
      // bd-fxk3t8 — rows of placeholders where the list will be, instead of a spinner.
      <SkeletonList rows={3} label={C.loading} className="py-2" />
    );
  }
  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center">
        <p className="text-[16px] font-semibold text-[#1d2025]">{C.loadFailed}</p>
        <button type="button" onClick={onRetry} className={cn('min-h-[56px] rounded-2xl bg-[#33374a] px-6 text-[16px] font-semibold text-white', FOCUS)}>
          {C.tryAgain}
        </button>
      </div>
    );
  }
  return null;
}

/** A provider's logo (the real file), or its initials on a neutral tile when there is none. */
export function ProviderMark({ logo, initials, size = 28, className }: { logo: string | null; initials: string; size?: number; className?: string }) {
  if (logo) return <img src={logo} alt="" width={size} height={size} className={cn('shrink-0 object-contain', className)} style={{ width: size, height: size }} />;
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center rounded-[6px] bg-[#33374a] text-[10px] font-extrabold text-white', className)} style={{ width: size, height: size }}>
      {initials}
    </span>
  );
}
