import type { ReactNode } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FeatureArt } from '../icons';
import { FOCUS } from '../ui/styles';
import { LESSONS_V2_COPY } from './copy';

/**
 * bd-fmf24g.3 — the head of a Lesson Plans page (v28 canvas `.ihead`): a 56px Back with its 40px white
 * circle, the Lesson Plans tile (52px, the D2 art at 40px; the viewer leaves it out), the breadcrumb
 * over the title (26px light). Feature-local until the frame (bd-fmf24g.1) ships a shared page head;
 * then this goes.
 */
export function LessonHeader({
  crumb, title, backTo, onBack, tile = true, right,
}: {
  crumb?: string;
  title: string;
  backTo?: string;
  onBack?: () => void;
  tile?: boolean;
  right?: ReactNode;
}) {
  const circle = (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]">
      <ChevronLeft className="h-[22px] w-[22px] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
  const back = 'flex h-14 w-14 shrink-0 items-center justify-center rounded-full';
  return (
    <header className="flex items-center gap-1 pb-1.5 pe-4 ps-1.5 pt-3.5 text-[#1d2025]">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label={LESSONS_V2_COPY.back} className={cn(back, FOCUS)}>{circle}</button>
      ) : (
        <Link to={backTo ?? '/portal/dashboard'} aria-label={LESSONS_V2_COPY.back} className={cn(back, FOCUS)}>{circle}</Link>
      )}
      {tile ? (
        <span className="me-2 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] border border-[#e5e7eb] bg-white" aria-hidden="true">
          <FeatureArt feature="lessons" size={40} />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {crumb ? <div className="text-[13px] font-medium text-[#6b7280]">{crumb}</div> : null}
        <h1 dir="auto" className="text-[26px] font-light leading-[1.2] tracking-[-0.01em]">{title}</h1>
      </div>
      {right}
    </header>
  );
}

/** Loading, a failed load (with Try again), or nothing to show — the states every list page shares. */
export function LoadState({ status, empty, onRetry }: { status: 'idle' | 'loading' | 'error' | 'ok'; empty: boolean; onRetry: () => void }) {
  if (status === 'loading') {
    return (
      <div role="status" aria-label={LESSONS_V2_COPY.title} className="flex justify-center py-10 text-[#6b7280]">
        <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center">
        <p className="text-[16px] font-semibold text-[#1d2025]">{LESSONS_V2_COPY.loadFailed}</p>
        <button
          type="button"
          onClick={onRetry}
          className={cn('min-h-[56px] rounded-2xl bg-[#33374a] px-6 text-[16px] font-semibold text-white', FOCUS)}
        >
          {LESSONS_V2_COPY.tryAgain}
        </button>
      </div>
    );
  }
  if (status === 'ok' && empty) {
    return <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{LESSONS_V2_COPY.nothingHere}</p>;
  }
  return null;
}
