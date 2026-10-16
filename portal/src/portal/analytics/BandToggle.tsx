import { useAnalyticsView } from '../lib/analyticsView';
import type { LpBand } from '../types/portal';
import { BAND_LOOK } from './views/trainingLook';

/**
 * bd-97x22y.3 — her Primary / Mid-High teachers toggle (LPEngagement.jsx LP_LEVEL_TABS): two big buttons at the top of
 * the tab, the chosen one filled in its colour — the same look and colours as the Trainings tab's toggle
 * (trainingLook.ts BAND_LOOK), so the two tabs read alike. On LP Engagement the band lives in the address
 * (?band=midhigh; Primary, her default, has no parameter), so a shared link and a reload keep it.
 */
export function useBandParam(): { band: LpBand; setBand: (b: LpBand) => void } {
  const { searchParams, setParams } = useAnalyticsView();
  const band: LpBand = searchParams.get('band') === 'midhigh' ? 'midhigh' : 'primary';
  return { band, setBand: (b) => setParams({ band: b === 'primary' ? null : b }) };
}

export function BandToggle({ label, labels, band, onBand }: {
  /** The group's name for a screen reader. */
  label: string;
  labels: Record<LpBand, string>;
  band: LpBand;
  onBand: (b: LpBand) => void;
}) {
  return (
    <div data-testid="lp-bands" role="group" aria-label={label} className="grid grid-cols-2 gap-3">
      {(['primary', 'midhigh'] as const).map((b) => {
        const on = band === b;
        const { color, Icon } = BAND_LOOK[b];
        return (
          <button
            key={b}
            type="button"
            data-testid={`band-${b}`}
            aria-pressed={on}
            onClick={() => onBand(b)}
            className="flex min-h-[56px] items-center gap-3 rounded-xl px-3 py-3 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-4"
            style={{ backgroundColor: on ? color : '#fff', border: `2px solid ${color}`, boxShadow: on ? `0 2px 8px ${color}33` : 'none' }}
          >
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: on ? 'rgba(255,255,255,0.25)' : `${color}18` }}>
              <Icon className="h-4 w-4" style={{ color: on ? '#fff' : color }} />
            </span>
            <span className="text-sm font-semibold" style={{ color: on ? '#fff' : color }}>{labels[b]}</span>
          </button>
        );
      })}
    </div>
  );
}
