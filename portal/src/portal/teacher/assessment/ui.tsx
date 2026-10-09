import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Loader2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CARD, CARD_SELECTED, FOCUS, LIST_CARD } from '../ui/styles';
import TeacherPage from '../TeacherPage';
import { ButtonWithReason } from '../ui/ButtonWithReason';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { STEPS, type Step } from './model';
import { SkeletonList } from '../../components/Skeleton';

/**
 * bd-fmf24g.6 — the Assessment pages' own small pieces, in the v28 canvas look (Assess*.dc.html): the
 * New paper's step frame and bar, tabs, the − n + stepper, a switch, a big radio choice, the dock
 * buttons and the load states. Every word comes in through props / copy.ts; every target is ≥56px.
 */

export const PRIMARY = 'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] px-4 text-[16px] font-semibold text-white';
export const OUTLINE = 'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] font-semibold text-[#1d2025]';
export const OFF = 'flex min-h-[56px] flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-[#e5e7eb] px-4 text-[16px] font-semibold text-[#9ca3af]';

/** "Questions", light 20px, with an optional chip right after it. */
export function Label({ children, chip }: { children: ReactNode; chip?: ReactNode }) {
  return (
    <h2 className="mx-1 mt-3 flex items-center gap-2 text-[20px] font-light">
      {children}
      {chip}
    </h2>
  );
}

export function Chip({ children, tone = 'grey' }: { children: ReactNode; tone?: 'grey' | 'indigo' | 'done' | 'warn' | 'error' }) {
  const tones = {
    grey: 'bg-[#e5e7eb] text-[#374151]',
    indigo: 'bg-[#33374a] text-white',
    done: 'bg-[#eaf6ef] text-[#2f7a52]',
    warn: 'bg-[#fef3c7] text-[#b45309]',
    error: 'bg-[#fee4e2] text-[#c8331f]',
  };
  return <span className={cn('inline-flex h-[26px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold', tones[tone])}>{children}</span>;
}

/** The New paper's frame: back to the step before, "New paper" over the step's name, its bar, and Next. */
export function StepFrame({
  step, backTo, next, children,
}: {
  step: Step;
  backTo: string;
  /** The dock: a link (`to`) or a button (`onPress`). `why` is the reason it is off, in words, or null when it works
   *  (bd-fmf24g.34: a disabled button always says why); `busy` is off too, with "Please wait" unless `why` says more. */
  next: { label: ReactNode; why: string | null; to?: string; onPress?: () => void; busy?: boolean };
  children: ReactNode;
}) {
  const C = useCopy(ASSESSMENT);
  const n = STEPS.indexOf(step) + 1;
  const icon = next.busy
    ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
    : <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />;
  const dock = (
    <ButtonWithReason
      label={next.label}
      reason={next.busy ? (next.why ?? C.why.wait) : next.why}
      to={next.to}
      onPress={next.onPress}
      icon={icon}
      testId="step-next"
    />
  );
  return (
    <TeacherPage crumb={C.newPaperCrumb} title={C.steps[step]} backTo={backTo} dock={dock} testId={`assessment-step-${step}`}>
      <div role="progressbar" aria-label={C.step(n, STEPS.length)} aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={n} className="flex gap-1.5 px-1">
        {STEPS.map((s, i) => (
          <i key={s} className={cn('h-[5px] flex-1 rounded-full', i < n ? 'bg-[#33374a]' : 'bg-[#e5e7eb]')} />
        ))}
      </div>
      {children}
    </TeacherPage>
  );
}

/** Two (or more) tabs in one white bar; the picked one indigo. Either/or, never both. */
export function Tabs<K extends string>({
  label, options, value, onChange,
}: { label: string; options: Array<{ key: K; label: ReactNode }>; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-2xl border border-[#e5e7eb] bg-white p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === value}
          onClick={() => onChange(o.key)}
          className={cn(
            'flex min-h-[56px] flex-1 items-center justify-center rounded-xl px-2 text-[16px] font-semibold',
            o.key === value ? 'bg-[#33374a] text-white' : 'text-[#4b5563]',
            FOCUS,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** − n + : two 56px squares and the number (never typed). */
export function Stepper({
  value, sub, onLess, onMore, lessLabel, moreLabel, canLess = true, canMore = true, compact = false,
}: {
  value: ReactNode; sub?: ReactNode; onLess: () => void; onMore: () => void; lessLabel: string; moreLabel: string;
  canLess?: boolean; canMore?: boolean; compact?: boolean;
}) {
  const sq = (on: boolean) => cn(
    'flex h-14 shrink-0 items-center justify-center rounded-[14px] bg-[#f3f4f6] text-[#33374a]',
    compact ? 'w-14' : 'w-14',
    !on && 'cursor-not-allowed opacity-35',
    FOCUS,
  );
  return (
    <div className={cn('flex items-center justify-between gap-3', compact ? '' : 'rounded-2xl border border-[#e5e7eb] bg-white p-2')}>
      <button type="button" aria-label={lessLabel} disabled={!canLess} onClick={onLess} className={sq(canLess)}>
        <Minus className="h-5 w-5" aria-hidden="true" />
      </button>
      <span className="flex flex-col items-center leading-none" aria-live="polite">
        <b className={cn('font-bold tabular-nums', compact ? 'text-[18px]' : 'text-[34px]')}>{value}</b>
        {sub && <small className="mt-1 text-[12px] font-semibold text-[#6b7280]">{sub}</small>}
      </span>
      <button type="button" aria-label={moreLabel} disabled={!canMore} onClick={onMore} className={sq(canMore)}>
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** A big option with a radio mark: icon tile, name, muted line. Picked = indigo edge on the tint. */
export function Choice({
  picked, onPick, icon, name, sub,
}: { picked: boolean; onPick: () => void; icon: ReactNode; name: ReactNode; sub?: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      onClick={onPick}
      className={cn('flex min-h-[76px] w-full items-center gap-3.5 p-2.5 pe-3.5 text-start', picked ? CARD_SELECTED : CARD, FOCUS)}
    >
      <span className={cn('flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl', picked ? 'bg-[#33374a] text-white' : 'bg-[#f3f4f6] text-[#33374a]')}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[17px] font-semibold">{name}</span>
        {sub && <span className="text-[13px] text-[#6b7280]">{sub}</span>}
      </span>
      <span className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2', picked ? 'border-[#33374a]' : 'border-[#c7cad6]')} aria-hidden="true">
        {picked && <i className="h-3 w-3 rounded-full bg-[#33374a]" />}
      </span>
    </button>
  );
}

/** A tick box row inside a list card (chapters, types, keep/remove). */
export function CheckRow({
  checked, onToggle, label, children, first, describedBy,
}: { checked: boolean; onToggle: () => void; label: ReactNode; children?: ReactNode; first?: boolean; describedBy?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-describedby={describedBy}
      onClick={onToggle}
      className={cn(
        'flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-start',
        !first && 'border-t border-[#f0f1f3]',
        checked && 'bg-[#f4f5f8]',
        FOCUS,
      )}
    >
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-2 text-white', checked ? 'border-[#33374a] bg-[#33374a]' : 'border-[#c7cad6]')} aria-hidden="true">
        {checked && <Check className="h-4 w-4" strokeWidth={3.2} />}
      </span>
      {label}
      {children}
    </button>
  );
}

/** An on/off switch row: icon tile, name, the switch. */
export function SwitchRow({ on, onFlip, icon, name }: { on: boolean; onFlip: () => void; icon: ReactNode; name: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onFlip}
      className={cn('flex min-h-[76px] w-full items-center gap-3.5 p-2.5 pe-3.5 text-start', CARD, FOCUS)}
    >
      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">{icon}</span>
      <span className="flex-1 text-[17px] font-semibold">{name}</span>
      <span className={cn('relative h-8 w-14 shrink-0 rounded-full', on ? 'bg-[#33374a]' : 'bg-[#d1d5db]')} aria-hidden="true">
        <i className={cn('absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow', on ? 'end-[3px]' : 'start-[3px]')} />
      </span>
    </button>
  );
}

/** One white card holding rows. */
export function ListCard({ label, children }: { label?: string; children: ReactNode }) {
  return <section aria-label={label} className={LIST_CARD}>{children}</section>;
}

/** Loading, a failed load (Try again), or nothing to show. */
export function LoadState({ status, empty, onRetry, emptyLabel }: {
  status: 'idle' | 'loading' | 'error' | 'ok'; empty?: boolean; onRetry: () => void; emptyLabel?: ReactNode;
}) {
  const C = useCopy(ASSESSMENT);
  if (status === 'loading' || status === 'idle') {
    return (
      // bd-fxk3t8 — rows of placeholders where the list will be, instead of a spinner.
      <SkeletonList rows={3} label={C.title} className="py-2" />
    );
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center">
        <p className="text-[16px] font-semibold">{C.loadFailed}</p>
        <button type="button" onClick={onRetry} className={cn(PRIMARY, 'flex-none px-6', FOCUS)}>{C.tryAgain}</button>
      </div>
    );
  }
  if (empty) {
    return <p className="rounded-2xl border border-dashed border-[#c7cad6] bg-white p-5 text-center text-[15px] text-[#6b7280]">{emptyLabel ?? C.nothingHere}</p>;
  }
  return null;
}
