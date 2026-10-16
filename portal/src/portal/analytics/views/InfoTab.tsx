import type { AnalyticsWords } from '../copy';
import { Section } from '../Section';

/**
 * bd-97x22y.2 — Information (PLAN v6 §2): "How these numbers are worked out", grouped as the tabs are, in her card
 * style (a numbered card per number). Static words; it shows even when the numbers did not load.
 */
export function InfoTab({ c }: { c: AnalyticsWords }) {
  return (
    <div data-testid="how-counted" aria-label={c.how.title} className="flex flex-col gap-7">
      {c.how.groups.map((g, gi) => (
        <Section key={g.title} id={`info-${gi}`} eyebrow={g.title}>
          <ol className="grid gap-3 lg:grid-cols-2">
            {g.items.map((item, i) => (
              <li key={item.term} data-testid="definition" className="flex gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-nu-leaf-light text-sm font-bold text-nu-button">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <h3 data-testid="term" className="text-base font-semibold text-foreground">{item.term}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ))}
    </div>
  );
}
