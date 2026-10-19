import type { AnalyticsWords } from './copy';
import { NO_VALUE } from './format';

/**
 * bd-97x22y.3 — the LP Engagement tab's two drawings, hers 1 to 1 (LPEngagement.jsx CircleGauge and
 * SectorSubjectChart), in plain HTML/SVG like BarChart: no chart library, so the values stay real text a test can
 * read and a phone gets the same drawing. Charts read left to right in Urdu too (decided 9 Oct), hence dir="ltr".
 */

/** Her sector ring (CircleGauge): the LP % on a ring in `color`, "LP Engage" under it. No % → "—", an empty ring. */
export function RingGauge({ pct, caption, color, c }: { pct: number | null; caption: [string, string]; color: string; c: AnalyticsWords }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const share = pct === null ? 0 : Math.min(100, Math.max(0, pct)) / 100;
  return (
    <span data-testid="ring" dir="ltr" className="relative mx-auto flex h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="44" cy="44" r={r} fill="none" strokeWidth="8" stroke={`${color}22`} />
        {share > 0 ? (
          <circle
            cx="44" cy="44" r={r} fill="none" strokeWidth="8" strokeLinecap="round" stroke={color}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - share)}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <b data-testid="ring-value" className="text-lg font-bold leading-none tabular-nums text-gray-800">
          {pct === null ? NO_VALUE : c.percent(String(pct))}
        </b>
        <span className="mt-0.5 text-center text-[9px] leading-tight text-gray-400">{caption[0]}<br />{caption[1]}</span>
      </span>
    </span>
  );
}

export interface ChartGroup { key: string; label: string }
export interface ChartSeries { key: string; label: string; color: string }

const PLOT_PX = 260;

/**
 * Her SectorSubjectChart: one group of bars per sector, one bar per subject (or grade), the LP % as the bar's height;
 * her scale — the biggest value plus 30%, rounded up to 5, at least 10, at most 100 — with six ticks; bars at most
 * 18px wide with 4px round tops; her legend under it. Every bar names itself on hover (her tooltip). A sector chosen in
 * the filters keeps its group and the others step back.
 */
export function GroupedBarChart({ testId, label, groups, series, value, selected, c }: {
  testId: string;
  label: string;
  groups: ChartGroup[];
  series: ChartSeries[];
  value: (group: string, series: string) => number | null;
  selected?: string | null;
  c: AnalyticsWords;
}) {
  const max = Math.max(10, ...groups.flatMap((g) => series.map((s) => value(g.key, s.key) ?? 0)));
  const yMax = Math.min(100, Math.ceil((max * 1.3) / 5) * 5);
  const ticks = [0, 1, 2, 3, 4, 5].map((i) => Math.round((yMax * i) / 5));
  const at = (v: number) => (PLOT_PX * Math.min(v, yMax)) / yMax;
  const chosen = selected?.toLowerCase() ?? null;
  const pctText = (v: number | null) => (v === null ? NO_VALUE : c.percent(String(v)));

  return (
    <figure data-testid={testId} aria-label={label} dir="ltr" className="m-0">
      <div className="flex">
        <div aria-hidden="true" className="relative w-[38px] shrink-0" style={{ height: PLOT_PX }}>
          {ticks.map((t) => (
            <span key={t} data-testid="tick" className="absolute end-1.5 translate-y-1/2 text-[10px] leading-none tabular-nums" style={{ bottom: at(t), color: '#9CA3AF' }}>
              {pctText(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: PLOT_PX }}>
          {ticks.map((t) => (
            <div key={t} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed" style={{ bottom: at(t), borderColor: '#f3f4f6' }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-1 sm:gap-4">
            {groups.map((g) => {
              const quiet = chosen !== null && g.key.toLowerCase() !== chosen;
              return (
                <div key={g.key} data-testid={`group-${g.key}`} className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] transition-opacity" style={{ opacity: quiet ? 0.4 : 1 }}>
                  {series.map((s) => {
                    const v = value(g.key, s.key);
                    if (v === null) return <span key={s.key} className="min-w-0 max-w-[18px] flex-1" />;
                    return (
                      <span
                        key={s.key}
                        data-testid="bar"
                        data-series={s.key}
                        title={`${g.label} · ${s.label}: ${pctText(v)}`}
                        className="block min-w-[2px] max-w-[18px] flex-1 rounded-t-[4px]"
                        style={{ height: at(v), backgroundColor: s.color }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ms-[38px] mt-2 flex gap-1 sm:gap-4">
        {groups.map((g) => (
          <span key={g.key} className="min-w-0 flex-1 break-words text-center text-[11px] font-medium leading-tight" style={{ color: '#6B7280' }}>{g.label}</span>
        ))}
      </div>
      <ul data-testid="legend" className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
        {series.map((s) => (
          <li key={s.key} data-testid={`legend-${s.key}`} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: '#4B5563' }}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
