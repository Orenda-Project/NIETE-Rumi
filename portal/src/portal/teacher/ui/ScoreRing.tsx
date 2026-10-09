import { cn } from '@/lib/utils';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — ScoreRing: a score as a ring filled to its percentage, the number inside (the coach's Digital Coach score on an
 * observation). Indigo on the light-indigo track, white centre, tabular number. The percentage comes from the data; with no score
 * the ring is empty and says "—". It is information: an image named "{label} {value}%" (never colour alone, the number is in it).
 * `size` 64 by default (48 for a row). Canvas: Coach_Observation (`ring64`).
 */
export interface ScoreRingProps {
  /** 0–100; null / undefined = no score yet. Clamped. */
  value: number | null | undefined;
  /** What it is, for a screen reader ("Digital Coach score"). */
  label: string;
  size?: number;
  className?: string;
}

export function ScoreRing({ value, label, size = 64, className }: ScoreRingProps) {
  const kit = useKitCopy();
  const has = typeof value === 'number' && Number.isFinite(value);
  const pct = has ? Math.max(0, Math.min(100, Math.round(value as number))) : 0;
  const text = has ? `${pct}%` : kit.noValue;
  const inner = Math.round(size * 0.78);
  return (
    <span
      role="img"
      aria-label={`${label} ${text}`}
      data-pct={pct}
      className={cn('flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size, background: `conic-gradient(#33374a 0 ${pct}%, #e8e9f0 ${pct}% 100%)` }}
    >
      <span
        className={cn('flex items-center justify-center rounded-full bg-white font-bold tabular-nums', size >= 56 ? 'text-[15px]' : 'text-[13px]')}
        style={{ width: inner, height: inner }}
      >
        {text}
      </span>
    </span>
  );
}
