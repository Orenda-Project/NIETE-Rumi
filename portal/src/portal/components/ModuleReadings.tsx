/**
 * ModuleReadings — the partner's required reading for one module.
 *
 * Operator, 2026-09-23: add I-SAPS's per-module reading list, COLLAPSIBLE.
 *
 * bd-klecr.9 (2026-10-08): I-SAPS replaced its 95-item recommended list with a
 * short MANDATORY one, so this is "Required reading", OPEN by default, and each
 * reading says what to read (`section`) and what the teacher will be able to do
 * after it (`outcome`). Nothing is gated on it (operator).
 *
 * Items the partner has no free copy of yet are still named — in their own
 * nested list — rather than shown as dead links. The list itself comes from
 * the bot (isaps-readings.rules), via /training/modules.
 */

import { useState } from 'react';
import { BookOpen, ChevronRight, ExternalLink, FileText, PlayCircle } from 'lucide-react';

export type ReadingItem = {
  title: string;
  author: string;
  type: string;
  /** bd-klecr.9 — what to read ("Chapter 2 (pp. 37–40)"), why, and what she will be able to do. */
  section?: string;
  rationale?: string;
  outcome?: string;
  description: string;
  url: string | null;
};

export type ModuleReadingList = {
  available: ReadingItem[];
  unavailable: ReadingItem[];
};

function kindOf(type: string): 'video' | 'book' | 'doc' {
  if (/video|ted|talk|lecture/i.test(type)) return 'video';
  if (/book|novel|textbook/i.test(type)) return 'book';
  return 'doc';
}

function Item({ r }: { r: ReadingItem }) {
  const targeted = Boolean(r.section || r.outcome);
  const kind = kindOf(r.type);
  const Icon = kind === 'video' ? PlayCircle : kind === 'book' ? BookOpen : FileText;
  const meta = [r.author, r.type].filter(Boolean).join(' · ');
  const body = (
    <>
      <span
        className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          r.url ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium text-foreground break-words">{r.title}</span>
        {meta && <span className="block text-sm text-muted-foreground">{meta}</span>}
        {r.section && (
          <span className="block text-sm text-foreground mt-1">
            <span className="font-semibold">Read:</span> {r.section}
          </span>
        )}
        {r.outcome && (
          <span className="block text-sm text-muted-foreground mt-0.5">
            <span className="font-medium">You will be able to:</span> {r.outcome}
          </span>
        )}
        {!targeted && r.description && (
          <span className="block text-sm text-muted-foreground mt-0.5">{r.description}</span>
        )}
      </span>
    </>
  );
  if (!r.url) {
    return <div className="flex items-start gap-3 px-3.5 py-2.5 opacity-80">{body}</div>;
  }
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 px-3.5 py-2.5 rounded-lg hover:bg-muted/50 transition-colors"
    >
      {body}
      <ExternalLink className="w-4 h-4 mt-1 text-muted-foreground shrink-0" aria-hidden="true" />
    </a>
  );
}

export default function ModuleReadings({ readings }: { readings: ModuleReadingList | null | undefined }) {
  // Open by default: it is the partner's required reading (bd-klecr.9).
  const [open, setOpen] = useState(true);
  const [offOpen, setOffOpen] = useState(false);
  if (!readings) return null;
  const on = readings.available || [];
  const off = readings.unavailable || [];
  if (on.length === 0 && off.length === 0) return null;

  const counts = [
    on.length > 0 ? `${on.length} reading${on.length === 1 ? '' : 's'}` : null,
    off.length > 0 ? `${off.length} coming soon` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mt-3 pt-2 border-t" data-testid="module-readings">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        data-testid="module-readings-toggle"
        className="w-full text-left rounded-lg px-3.5 py-2.5 flex items-center gap-2 hover:bg-muted/50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="flex-1 text-[15px] font-semibold text-foreground">Required reading</span>
        <span className="text-sm text-muted-foreground shrink-0">{counts}</span>
      </button>

      {open && (
        <div className="pb-2">
          <p className="px-3.5 pb-2 text-sm text-muted-foreground">
            Set by I-SAPS for this module: read the part shown under each title.
          </p>
          {on.length === 0 && (
            <p className="px-3.5 pb-2 text-sm text-muted-foreground">No online resources yet for this module.</p>
          )}
          {on.map((r, i) => <Item key={`on-${i}`} r={r} />)}

          {off.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setOffOpen(o => !o)}
                aria-expanded={offOpen}
                className="px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
              >
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${offOpen ? 'rotate-90' : ''}`} />
                Not yet available online ({off.length})
              </button>
              {offOpen && off.map((r, i) => <Item key={`off-${i}`} r={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
