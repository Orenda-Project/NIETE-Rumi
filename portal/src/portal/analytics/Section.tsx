import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { MetricTile, type Feature } from '../newui';

/**
 * bd-97x22y.2 — the ICT dashboard's sectioned layout in our tokens (PLAN v6 §1): a small capital eyebrow over each
 * group of numbers ("SCHOOLS", "SECTORS — CLICK TO VIEW SCHOOL BREAKDOWN", …). Hers is green; ours is the kit's
 * dark button green, which reads at 4.5:1 on the page. The words are written in sentence case and set in capitals
 * here, so an Urdu table needs no capitals of its own.
 */
export function Section({ id, eyebrow, aside, busy, className, children }: {
  id: string;
  eyebrow: string;
  aside?: ReactNode;
  /** Its numbers are still on their way (aria-busy). */
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={`section-${id}`} aria-labelledby={`eyebrow-${id}`} aria-busy={busy ? 'true' : undefined} className={cn('min-w-0', className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id={`eyebrow-${id}`}
          data-testid="eyebrow"
          className="text-xs font-bold uppercase tracking-[0.12em] text-nu-button rtl:text-[13px] rtl:normal-case rtl:tracking-normal"
        >
          {eyebrow}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A section's tiles: two across on a phone, `cols` across on a desktop. */
export function TileGrid({ cols = 4, label, children }: { cols?: 2 | 3 | 4; label?: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('grid grid-cols-2 gap-2.5', cols === 3 && 'lg:grid-cols-3', cols === 4 && 'lg:grid-cols-4')}
    >
      {children}
    </div>
  );
}

/**
 * One number, as the kit's MetricTile draws it (not tappable: nothing is behind a tile). A FICO / HITL tile is marked
 * `data-score` — the only tiles whose value carries a %.
 */
export function Tile({ k, feature, value, label, chips, score, className }: {
  k: string;
  feature: Feature;
  value: string | null;
  label: string;
  chips?: ReactNode;
  score?: 'fico' | 'hitl';
  className?: string;
}) {
  const tile = <MetricTile testId={`tile-${k}`} feature={feature} value={value} label={label} chips={chips} />;
  return (
    <div data-score={score} className={cn('flex min-w-0', className)}>
      {tile}
    </div>
  );
}
