import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * bd-5rz1v.19 — the status screen's centrepiece (deep-screens.html `.hero`): a ring or a big
 * icon, one word or two under it, and chips. Used for "Preparing… 1:10", "Ready", "Passed 4/5".
 *
 *   ring  116px: a GREEN arc (progress) on the indigo-light track, a white centre, the count
 *         28px/800 in the middle. Read as a progress bar named by the title.
 *   icon  84px circle: done green, waiting amber, neutral grey; `spinning` turns the icon,
 *         only when motion is allowed.
 * Title 22px/800. `live` announces a change (a spinner turning into "Ready").
 */
export interface HeroProps {
  title: string;
  /** value 0–1 fills the arc; text sits in the middle ("1:10", "4/5"). */
  ring?: { value: number; text: string };
  icon?: LucideIcon;
  tone?: 'done' | 'waiting' | 'neutral';
  spinning?: boolean;
  chips?: ReactNode;
  live?: boolean;
}

const TONE = {
  done: 'bg-nu-done-bg text-nu-done',
  waiting: 'bg-nu-chip-warning-bg text-nu-chip-warning',
  neutral: 'bg-nu-neutral-tile text-nu-neutral-icon',
} as const;

export function Hero({ title, ring, icon: Icon, tone = 'neutral', spinning, chips, live }: HeroProps) {
  const fraction = ring ? Math.max(0, Math.min(1, Number(ring.value) || 0)) : 0;
  return (
    <div
      data-testid="newui-hero"
      aria-live={live ? 'polite' : undefined}
      className="flex flex-col items-center gap-2.5 px-2.5 py-[18px] text-center"
    >
      {ring ? (
        <span
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuetext={ring.text}
          style={{ '--nu-ring': `${Math.round(fraction * 360)}deg` } as CSSProperties}
          className="relative flex h-[116px] w-[116px] items-center justify-center rounded-full bg-[conic-gradient(theme(colors.nu.progress.DEFAULT)_var(--nu-ring),theme(colors.nu.progress.track)_0)]"
        >
          <span aria-hidden="true" className="absolute inset-2.5 rounded-full bg-nu-surface-card" />
          <span className="relative text-[28px] font-extrabold tabular-nums text-nu-surface-text">{ring.text}</span>
        </span>
      ) : null}
      {!ring && Icon ? (
        <span data-testid="newui-hero-icon" aria-hidden="true" className={cn('flex h-[84px] w-[84px] items-center justify-center rounded-full', TONE[tone])}>
          <Icon className={cn('h-10 w-10', spinning && 'motion-safe:animate-spin')} />
        </span>
      ) : null}
      <b className="text-[22px] font-extrabold text-nu-surface-text rtl:font-bold rtl:leading-[2]">{title}</b>
      {chips ? <div className="flex flex-wrap justify-center gap-1.5">{chips}</div> : null}
    </div>
  );
}
