import type { AnalyticsTab } from '../lib/analyticsView';
import { Eye, UserCheck, ClipboardCheck, CalendarDays } from 'lucide-react';

/**
 * The top of both Analytics pages (operator, 2026-09-30): tabs for the three
 * parts of STEPS — Observations · Attendance · Principal Remarks, one shown at
 * a time — and one From / To window over the whole page.
 *
 * Both live in the ADDRESS, not in component state — see lib/analyticsView.
 */

const TABS: Array<{ key: AnalyticsTab; label: string; icon: typeof Eye }> = [
  { key: 'observations', label: 'Observations', icon: Eye },
  { key: 'attendance', label: 'Attendance', icon: UserCheck },
  { key: 'remarks', label: 'Principal Remarks', icon: ClipboardCheck },
];

export const AnalyticsControls = ({ tab, onTab, from, to, onRange }: {
  tab: AnalyticsTab; onTab: (t: AnalyticsTab) => void;
  from: string | null; to: string | null;
  onRange: (r: { from?: string | null; to?: string | null }) => void;
}) => (
  <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div role="tablist" aria-label="Analytics" className="flex flex-wrap gap-2">
      {TABS.map(({ key, label, icon: Icon }) => {
        const on = tab === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`tab-${key}`}
            onClick={() => onTab(key)}
            className={`inline-flex items-center gap-2 rounded-full border-2 px-5 py-2.5 text-sm font-semibold transition-colors ${
              on ? 'border-accent bg-accent text-white shadow-sm' : 'border-border bg-white text-foreground hover:border-accent/50'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        );
      })}
    </div>

    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-3 shadow-sm">
      <CalendarDays className="w-5 h-5 text-accent mb-2" />
      <div className="flex flex-col gap-1">
        <label htmlFor="analytics-from" className="text-xs text-muted-foreground">From</label>
        <input
          id="analytics-from" data-testid="analytics-from" type="date" value={from || ''} max={to || undefined}
          onChange={(e) => onRange({ from: e.target.value || null })}
          className="border border-border rounded-md px-3 py-2 text-sm bg-white"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="analytics-to" className="text-xs text-muted-foreground">To</label>
        <input
          id="analytics-to" data-testid="analytics-to" type="date" value={to || ''} min={from || undefined}
          onChange={(e) => onRange({ to: e.target.value || null })}
          className="border border-border rounded-md px-3 py-2 text-sm bg-white"
        />
      </div>
      <button
        type="button"
        data-testid="analytics-all-time"
        onClick={() => onRange({ from: null, to: null })}
        disabled={!from && !to}
        className="rounded-md px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10 disabled:text-muted-foreground disabled:hover:bg-transparent"
      >
        All time
      </button>
    </div>
  </div>
);
