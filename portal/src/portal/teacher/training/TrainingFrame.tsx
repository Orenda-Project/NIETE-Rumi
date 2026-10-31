import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCopy } from '../i18n';
import { cn } from '@/lib/utils';
import { TrainingFrameContext, type TrainingFrameProps } from '../../newui/training/frame';
import TeacherPage from '../TeacherPage';
import { CARD, FOCUS } from '../ui/styles';
import { TRAINING } from './copy';
import { SkeletonList } from '../../components/Skeleton';
import type { CourseTile } from './model';

/**
 * bd-fmf24g.5 — every teacher v2 Training page is the shared v2 page (TeacherPage, bd-fmf24g.1) with the
 * Training tile beside the title: Back, the breadcrumb over the title (both wrap), information under the
 * header (`context`, the teaching level on the main page), then the column.
 */
export function TrainingPageV2({
  crumb, title, backTo, onBack, right, context, dock, testId, children,
}: TrainingFrameProps & { context?: ReactNode; dock?: ReactNode; testId?: string }) {
  return (
    <TeacherPage feature="training" crumb={crumb} title={title} backTo={backTo} onBack={onBack} action={right} chips={context} dock={dock} testId={testId}>
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
  const C = useCopy(TRAINING);
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

/** A slim card that says there is nothing yet (no training, no questions). */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{children}</p>;
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

/**
 * A provider tile's line under its name: "76% · Level 3 of 4" (a ladder), "76% · 3 of 5 courses" (one level), or the %
 * alone. The hub's tiles and the coach's School card (bd-hl4a4y) write it the same way.
 */
export function useTileLine() {
  const C = useCopy(TRAINING);
  return (t: Pick<CourseTile, 'pct' | 'sub'>) => {
    const sub = t.sub?.kind === 'level' ? C.levelOf(t.sub.n, t.sub.of) : t.sub?.kind === 'courses' ? C.coursesOf(t.sub.done, t.sub.total) : null;
    return [C.pct(t.pct), sub].filter(Boolean).join(' · ');
  };
}

/**
 * A provider's mark inside its progress ring (parts done, or a full green disc when all are). The hub's tile draws it,
 * and the coach's School card draws the same one for a teacher's trainings (bd-hl4a4y).
 */
export function ProviderRing({ logo, initials, ring }: { logo: string | null; initials: string; ring: { pct: number; done: boolean; label: string } }) {
  return (
    <span
      role="img"
      aria-label={ring.label}
      className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full"
      style={{ background: ring.done ? '#2f7a52' : `conic-gradient(#2f7a52 0 ${ring.pct}%, #e5e7eb ${ring.pct}% 100%)` }}
    >
      <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white">
        <ProviderMark logo={logo} initials={initials} size={28} />
      </span>
    </span>
  );
}

/**
 * bd-s42dye.6 — a provider's tile (the teacher hub's, extracted so the coach's Training Library draws the same one):
 * its mark inside a ring (or, in the library, alone on a white tile), its name, a line under it (`children`). `ring` is the hub's progress ring (parts done, or a
 * full green disc when all are); with none the mark stands alone on a white tile, so the library shows no progress.
 * The name steps down a size when it runs long (the renamed programmes reach 80 characters, bd-2gia5l).
 */
export function ProviderTile({
  to, testId, label, logo, initials, ring, className, children,
}: {
  to: string;
  testId: string;
  label: string;
  logo: string | null;
  initials: string;
  ring: { pct: number; done: boolean; label: string } | null;
  /** A tile that spans both columns (an odd one out). */
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn(CARD, 'flex min-h-[150px] flex-col items-start justify-between gap-3 rounded-[18px] p-4', FOCUS, className)}
    >
      {ring ? (
        <ProviderRing logo={logo} initials={initials} ring={ring} />
      ) : (
        // No ring, no progress: the mark alone on a white tile, as the page's feature tile is drawn.
        <span aria-hidden="true" className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[14px] border border-[#e5e7eb] bg-white">
          <ProviderMark logo={logo} initials={initials} size={40} />
        </span>
      )}
      <span className="flex flex-col items-start gap-1">
        <b className={cn('font-semibold leading-tight', Array.from(label).length > 32 ? 'text-[15px]' : 'text-[18px]')}>{label}</b>
        {children}
      </span>
    </Link>
  );
}
