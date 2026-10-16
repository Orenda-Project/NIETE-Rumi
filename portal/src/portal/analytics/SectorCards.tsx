import type { ReactNode } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnalyticsWords } from './copy';

/**
 * bd-97x22y.2 — the ICT dashboard's sector cards (PLAN v6 §2): one card per region, in sector order. Tapping one
 * chooses that region — the same choice as its chip in the filter bar, so the address, the tiles and the chip agree
 * — and its schools open under the cards ("School breakdown — B.K", with Back to all regions). Tapping the chosen
 * card again goes back too. The chosen card is drawn in the selection indigo.
 */
export function SectorGrid({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2.5 sm:grid-cols-3', wide && 'xl:grid-cols-6')}>
      {children}
    </div>
  );
}

export function SectorCard({ region, selected, onSelect, action, hide, children }: {
  region: string;
  selected: boolean;
  onSelect: () => void;
  /** "View schools" / "View details" / "View school visits". */
  action: string;
  /** On the chosen card: "Hide schools". */
  hide: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={`sector-card-${region}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl border-2 bg-white p-3.5 text-start shadow-sm transition-colors sm:p-4',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
        selected ? 'border-primary ring-2 ring-primary/15' : 'border-border hover:border-primary/40',
      )}
    >
      <span className="mb-2 flex items-center gap-2">
        <span aria-hidden="true" className={cn('h-4 w-1 shrink-0 rounded-full', selected ? 'bg-primary' : 'bg-nu-progress')} />
        <span className="truncate text-base font-bold text-foreground">{region}</span>
      </span>
      <span className="flex flex-1 flex-col">{children}</span>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', selected && 'rotate-180')} aria-hidden="true" />
        {selected ? hide : action}
      </span>
    </button>
  );
}

/** A big count with its name under it, on a card ("229" / "LPs opened"). */
export function CardCount({ value, label, testId }: { value: string; label: string; testId?: string }) {
  return (
    <span data-testid={testId} className="flex flex-col">
      <span className="text-2xl font-extrabold leading-none tabular-nums text-foreground sm:text-[28px]">{value}</span>
      <span className="mt-1 text-xs font-semibold text-muted-foreground">{label}</span>
    </span>
  );
}

/** "68 of 135 teachers" over a plain grey bar: how many of the N, never a percentage, never a colour band. */
export function ShareLine({ text, x, n }: { text: string; x: number; n: number }) {
  const share = n > 0 ? Math.min(1, Math.max(0, x / n)) : 0;
  return (
    <span className="mt-2.5 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{text}</span>
      <span data-testid="share-bar" aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-nu-progress-track">
        <span className="block h-full rounded-full bg-nu-surface-chevron" style={{ width: `${share * 100}%` }} />
      </span>
    </span>
  );
}

/** The chosen sector's schools, under the cards. */
export function Breakdown({ c, region, onBack, children }: {
  c: AnalyticsWords;
  region: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section data-testid="breakdown" aria-labelledby="breakdown-title" className="mt-5 rounded-2xl border border-border bg-secondary/40 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          data-testid="breakdown-back"
          onClick={onBack}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-white px-3.5 text-sm font-semibold text-foreground shadow-sm hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {c.breakdown.back}
        </button>
        <h3 id="breakdown-title" data-testid="breakdown-title" className="text-base font-bold text-foreground">
          {c.breakdown.title(region)}
        </h3>
      </div>
      {children}
    </section>
  );
}
