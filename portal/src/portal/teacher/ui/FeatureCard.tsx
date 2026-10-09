import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FeatureArt } from '../icons/FeatureArt';
import { FEATURE_HUE, type AnyFeature } from '../icons/features';
import { StatusChip } from './StatusChip';
import type { ChipData } from './styles';

/**
 * bd-fmf24g.27 — FeatureCard: a section of an Analytics-style page that wears its feature (Analytics_A, operator
 * 2026-10-10). A white card; its header is the feature's light tint with the art on a white 48px tile and the title in
 * the feature's colour (17px/700); the body is the page's own content (a chart, meter rows, remarks). Information only,
 * so it has no chevron and no pressed look. `count` is a white chip in the header's colour.
 *
 * MeterRow: one label, an optional chip or two, a value, and a bar in the feature's colour on its tint (areas,
 * attendance). Charts and bars take the colour of the feature they measure; grade colours are never used here.
 */
export interface FeatureCardProps {
  feature: AnyFeature;
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
}

export function FeatureCard({ feature, title, count, children, className }: FeatureCardProps) {
  const hue = FEATURE_HUE[feature];
  return (
    <section
      aria-label={title}
      data-feature-card={feature}
      className={cn('flex flex-col overflow-hidden rounded-[20px] border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]', className)}
    >
      <div className="flex min-h-[64px] items-center gap-3 py-2.5 pe-3.5 ps-2.5" style={{ background: hue.bg }}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-white">
          <FeatureArt feature={feature} size={40} motion={false} />
        </span>
        <h3 className="min-w-0 flex-1 text-[17px] font-bold" style={{ color: hue.fg }}>{title}</h3>
        {count !== undefined ? (
          <span className="inline-flex h-[26px] shrink-0 items-center rounded-full bg-white px-2.5 text-[12px] font-semibold tabular-nums" style={{ color: hue.fg }}>{count}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5 p-3.5">{children}</div>
    </section>
  );
}

export interface MeterRowProps {
  feature: AnyFeature;
  label: string;
  /** The number beside the label ("94%"). */
  value?: string;
  /** 0–100. */
  pct: number;
  /** Words after the value ("present"). */
  unit?: string;
  chips?: readonly ChipData[];
}

export function MeterRow({ feature, label, value, pct, unit, chips = [] }: MeterRowProps) {
  const hue = FEATURE_HUE[feature];
  const width = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div data-meter-row className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="min-w-0 flex-1">{label}</span>
        {chips.map((c) => <StatusChip key={c.text} {...c} />)}
        {value ? (
          <span className="flex items-baseline gap-1.5 text-[13px] font-medium text-[#6b7280]">
            <b className="text-[22px] font-light tabular-nums text-[#1d2025]">{value}</b>
            {unit ? <span>{unit}</span> : null}
          </span>
        ) : null}
      </div>
      <span className="relative block h-2 overflow-hidden rounded-full" style={{ background: hue.bg }} aria-hidden="true">
        <i className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${width}%`, background: hue.fg }} />
      </span>
    </div>
  );
}
