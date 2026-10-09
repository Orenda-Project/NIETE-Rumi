import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { GRID } from './styles';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — StatStrip: four or five FLAT numbers under a row, so a coach compares dozens of schools or teachers at a glance
 * (KpiTiles is too big for a list). A grey strip with a hairline above and between: the number 17px/700, its label 11px under it.
 * Information only, never tappable; a missing value shows "—". At most five. Sits at the bottom of a card (flush, no margin).
 * Canvas: Coach_People, Coach_School, Coach_Visit.
 */
export interface StatItem {
  value: number | string | null | undefined;
  label: string;
}

export interface StatStripProps {
  items: readonly StatItem[];
  copy?: Partial<Pick<TeacherUiCopy, 'noValue'>>;
  className?: string;
}

export function StatStrip({ items, copy, className }: StatStripProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const shown = items.slice(0, 5);
  return (
    <div className={cn(GRID, 'border-t border-[#e5e7eb] bg-[#f9fafb]', className)} style={{ gridTemplateColumns: `repeat(${shown.length || 1}, minmax(0, 1fr))` }}>
      {shown.map((it, i) => {
        const v = it.value === null || it.value === undefined || it.value === '' ? words.noValue : typeof it.value === 'number' ? it.value.toLocaleString('en-US') : String(it.value);
        return (
          <span key={`${it.label}-${i}`} data-stat role="group" aria-label={`${it.label}, ${v}`} className={cn('flex flex-col gap-px px-2.5 py-[9px]', i > 0 && 'border-s border-[#eef0f3]')}>
            <b aria-hidden="true" className="text-[17px] font-bold tabular-nums">{bidi(v)}</b>
            <small aria-hidden="true" className="text-[11px] leading-[1.2] text-[#6b7280]">{it.label}</small>
          </span>
        );
      })}
    </div>
  );
}
