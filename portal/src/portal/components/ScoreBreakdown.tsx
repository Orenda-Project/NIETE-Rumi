/**
 * Her scores, from the framework she was actually assessed on.
 *
 * This replaces six OECD goal bars that read `scores.goal1_total…goal5_total`
 * — keys a FICO session does not contain, so five of them rendered zero under
 * labels her framework has never used, silently, because each read carried a
 * `|| 0`.
 *
 * The component names NO framework and NO domain. Everything here comes from
 * the bot's own score adapter, the same one that renders the report image she
 * receives on WhatsApp, so a sixth framework never requires a portal change.
 *
 * Groups arrive strongest-first. The weakest is therefore last, and is the one
 * opened by default: the evidence under it is what a teacher would act on.
 */

import { useState } from 'react';
import { ChevronDown, Target } from 'lucide-react';
import type { ScoreBreakdown as Breakdown, BreakdownGroup } from '../types/portal';
import { UrduAware } from './UrduAware';

/** Bar colour by band. Semantic, not the accent — this encodes standing. */
function bandClass(pct: number): string {
  if (pct >= 75) return 'bg-emerald-600';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function Domain({ group, open, onToggle }: {
  group: BreakdownGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const scored = group.indicators.filter((i) => i.applicable);
  const withEvidence = scored.filter((i) => i.evidence || i.evidence_summary);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full py-3 text-left"
      >
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          <span className="font-medium text-foreground">
            <span className="text-muted-foreground font-mono text-xs mr-2">{group.key}</span>
            {group.name}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
            {group.score}/{group.max} · {group.pct}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-secondary rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${bandClass(group.pct)}`}
              style={{ width: `${Math.max(0, Math.min(100, group.pct))}%` }}
            />
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {open && (
        <div className="pb-4 space-y-3">
          {scored.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No indicators were scored in this section.
            </p>
          )}

          {scored.map((ind) => (
            <div key={ind.id || ind.name} className="pl-3 border-l-2 border-border">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-foreground">
                  <span className="text-muted-foreground font-mono text-xs mr-1.5">{ind.id}</span>
                  {ind.name}
                </span>
                <span className="text-sm font-medium tabular-nums shrink-0">{ind.score}</span>
              </div>
              {/* The quote from her own lesson. Shown, not hidden behind a tap:
                  it is the only thing on the page that explains WHY a number
                  is what it is. */}
              {(ind.evidence || ind.evidence_summary) && (
                <UrduAware
                  as="p"
                  text={ind.evidence_summary || ind.evidence || ''}
                  className="mt-1 text-xs leading-relaxed text-muted-foreground"
                />
              )}
            </div>
          ))}

          {/* An indicator that did not apply is not a mark she lost — FICO
              gates several on the lesson's subject. Saying so beats leaving a
              silent gap in the list. */}
          {group.indicators.length > scored.length && (
            <p className="text-xs text-muted-foreground pl-3">
              {group.indicators.length - scored.length} indicator
              {group.indicators.length - scored.length === 1 ? '' : 's'} did not apply to this lesson.
            </p>
          )}

          {scored.length > 0 && withEvidence.length === 0 && (
            <p className="text-xs text-muted-foreground pl-3">
              No evidence quotes were recorded for this section.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  // Weakest last, so that is what opens — it is where the useful reading is.
  const weakest = breakdown.groups.length ? breakdown.groups.length - 1 : -1;
  const [openIndex, setOpenIndex] = useState<number>(weakest);

  if (!breakdown.groups.length) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
        <p className="text-sm text-muted-foreground">
          This session has not been scored yet.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-xl font-semibold">Your scores</h2>
        </div>
        {breakdown.framework && (
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
            {breakdown.framework}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Strongest first. Tap a section to see the evidence from your lesson.
      </p>

      <div>
        {breakdown.groups.map((g, i) => (
          <Domain
            key={g.domainKey || g.key}
            group={g}
            open={openIndex === i}
            onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
          />
        ))}
      </div>
    </div>
  );
}
