import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { KIT_COPY } from './copy';
import { FeatureIcon, type Feature } from './FeatureIcon';
import { FOCUS, PRESS } from './styles';

/**
 * bd-5rz1v.19 — a big number she can tap to see what is behind it (deep-screens.html `.mt`,
 * Home's metrics).
 *
 *   [icon]        a 40px neutral tile, the icon in the FEATURE's colour (FeatureIcon)
 *   14            28px/800, tabular
 *   Lesson plans  13px/700 muted
 *
 * 104px minimum, 14px padding, 18px corners, a 1.5px grey border: a tile, so it looks tappable.
 * `wide` spans the whole row (the icon beside the number and label, chips under them).
 * No number (loading, or the API failed) shows "—", never a blank or a 0 that is not true.
 */
export interface MetricTileProps {
  feature: Feature;
  value: number | string | null | undefined;
  label: string;
  to?: string;
  onClick?: () => void;
  wide?: boolean;
  chips?: ReactNode;
  /** What stands in for a missing number. */
  emptyValue?: string;
  testId?: string;
}

export function MetricTile({ feature, value, label, to, onClick, wide, chips, emptyValue = KIT_COPY.noValue, testId }: MetricTileProps) {
  const shown = value === null || value === undefined || value === '' ? emptyValue : value;
  const className = cn(
    'flex w-full min-w-0 rounded-[18px] border-[1.5px] border-nu-surface-line bg-nu-surface-card p-3.5 text-start',
    PRESS,
    FOCUS,
    wide ? 'col-span-2 min-h-[72px] flex-row items-center gap-1.5 md:col-span-4' : 'min-h-[104px] flex-col items-start gap-1.5',
  );
  const icon = (
    <span data-icon aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-nu-neutral-tile">
      <FeatureIcon feature={feature} className="h-[22px] w-[22px]" />
    </span>
  );
  const number = <b className="text-[28px] font-extrabold leading-none tabular-nums text-nu-surface-text">{shown}</b>;
  const name = (
    <span className="text-[13px] font-bold leading-[1.25] text-nu-surface-muted rtl:text-[13.5px] rtl:font-semibold rtl:leading-[1.9]">
      {label}
    </span>
  );
  const content = wide ? (
    <>
      {icon}
      <span className="flex min-w-0 flex-col gap-1">
        {number}
        {name}
        {chips ? <span className="flex flex-wrap gap-1.5">{chips}</span> : null}
      </span>
    </>
  ) : (
    <>
      {icon}
      {number}
      {name}
    </>
  );

  if (to) return <Link to={to} data-testid={testId} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} data-testid={testId} className={className}>{content}</button>;
}

/** Home's grid of tiles: two across on a phone, four on a desktop, 10px apart. */
export function MetricGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {children}
    </div>
  );
}
