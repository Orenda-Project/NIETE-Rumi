import { ChevronDown, Info } from 'lucide-react';
import type { AnalyticsWords } from './copy';

/** bd-s6qbts.3 — PLAN v3 §2 in plain words: what each number counts, so nobody has to guess. Folded by default. */
export function HowCounted({ c }: { c: AnalyticsWords }) {
  return (
    <details data-testid="how-counted" className="group mb-8 rounded-2xl border border-border bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <Info className="h-5 w-5 text-accent" aria-hidden="true" />
        {c.how.title}
        <ChevronDown className="ms-auto h-5 w-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <dl className="grid gap-x-6 gap-y-3 border-t border-border px-4 py-4 text-sm md:grid-cols-2">
        {c.how.items.map(({ term, text }) => (
          <div key={term}>
            <dt className="font-semibold text-foreground">{term}</dt>
            <dd className="mt-0.5 leading-relaxed text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
