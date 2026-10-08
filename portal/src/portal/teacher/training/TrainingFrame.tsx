import type { ReactNode } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import PortalLayout from '../../components/PortalLayout';
import { TrainingFrameContext, type TrainingFrameProps } from '../../newui/training/frame';
import { FeatureArt } from '../icons';
import { FOCUS } from '../ui/styles';
import { TRAINING_V2_COPY as C } from './copy';

/**
 * bd-fmf24g.5 — the frame of every teacher v2 Training page (v28 canvas `.ihead`): a 56px Back with its
 * 40px white circle, the Training tile (52px, the D2 art at 40px), the breadcrumb over a 26px light title,
 * then one phone-width column. Feature-local, as Lesson Plans' header is, until the shared page frame
 * (bd-fmf24g.1) carries a feature tile; then this goes.
 */
export const PAGE_BODY = 'mx-auto flex w-full max-w-[720px] flex-col gap-2.5 px-4 pb-5 pt-3';

export function TrainingHeader({
  crumb, title, backTo, onBack, right, children,
}: {
  crumb?: string;
  title: string;
  backTo?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Information under the title (the teaching level). */
  children?: ReactNode;
}) {
  const circle = (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]">
      <ChevronLeft className="h-[22px] w-[22px] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
  const back = 'flex h-14 w-14 shrink-0 items-center justify-center rounded-full';
  return (
    <div className="mx-auto w-full max-w-[720px] text-[#1d2025]">
      <header className="flex items-center gap-1 pb-1.5 pe-4 ps-1.5 pt-3.5">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label={C.back} className={cn(back, FOCUS)}>{circle}</button>
        ) : (
          <Link to={backTo ?? '/portal/teacher'} aria-label={C.back} className={cn(back, FOCUS)}>{circle}</Link>
        )}
        <span className="me-2 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] border border-[#e5e7eb] bg-white" aria-hidden="true">
          <FeatureArt feature="training" size={40} />
        </span>
        <div className="min-w-0 flex-1">
          {crumb ? <div className="text-[13px] font-medium text-[#6b7280]">{crumb}</div> : null}
          <h1 dir="auto" className="text-[26px] font-light leading-[1.2] tracking-[-0.01em]">{title}</h1>
        </div>
        {right}
      </header>
      {children}
    </div>
  );
}

/** A v2 Training page: the header, then the column. */
export function TrainingPageV2({
  crumb, title, backTo, onBack, right, context, children,
}: TrainingFrameProps & { context?: ReactNode }) {
  return (
    <PortalLayout ownHeading>
      <TrainingHeader crumb={crumb} title={title} backTo={backTo} onBack={onBack} right={right}>{context}</TrainingHeader>
      <div className={PAGE_BODY}>{children}</div>
    </PortalLayout>
  );
}

/**
 * The training screens reused from the new UI (a course, a part, the quick check, the exams, certificates,
 * My grades) build their own page through newui/training/frame's TrainingInner; mounted under this, they
 * get the v2 frame instead of the new UI's bar. Their logic, reads and words are untouched.
 */
export function InV2Frame({ children }: { children: ReactNode }) {
  return <TrainingFrameContext.Provider value={TrainingPageV2}>{children}</TrainingFrameContext.Provider>;
}

/** Loading, or a failed read with Try again. */
export function LoadState({ loading, failed, onRetry }: { loading: boolean; failed: boolean; onRetry: () => void }) {
  if (loading) {
    return (
      <div role="status" aria-label={C.loading} className="flex justify-center py-10 text-[#6b7280]">
        <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
      </div>
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
