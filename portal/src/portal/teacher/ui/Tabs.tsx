import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FOCUS } from './styles';

/**
 * bd-4404s7.1 — Tabs: two or three big tabs that switch what a page shows (the coach's Schools | Teachers; the teacher's My
 * Classes and Attendance have the same shape). One white bar with a 1px edge, tabs 56px tall, equal width; the picked one is
 * indigo with white words, the others grey; an optional count after the word. Buttons (`value`, `onChange`) when the tabs swap
 * content in place, links (`to` on each tab) when each is its own page: then the current one carries `aria-current="page"`.
 * Canvas: Coach_People.
 */
export interface TabItem {
  key: string;
  label: string;
  count?: number | string | null;
  to?: string;
}

export interface TabsProps {
  /** The tablist's name for a screen reader ("Schools and teachers"). */
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onChange?: (key: string) => void;
  className?: string;
}

const TAB = 'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl text-[16px] font-semibold';

export function Tabs({ label, tabs, value, onChange, className }: TabsProps) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 rounded-2xl border border-[#e5e7eb] bg-white p-1', className)}>
      {tabs.map((t) => {
        const on = t.key === value;
        const cls = cn(TAB, on ? 'bg-[#33374a] text-white' : 'text-[#4b5563]', FOCUS);
        const inner = (
          <>
            <span>{t.label}</span>
            {t.count !== undefined && t.count !== null ? <b className={cn('text-[13px] font-bold tabular-nums', on ? 'text-[#c7cad6]' : 'text-[#6b7280]')}>{t.count}</b> : null}
          </>
        );
        return t.to
          ? <Link key={t.key} to={t.to} aria-current={on ? 'page' : undefined} className={cls}>{inner}</Link>
          : (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange?.(t.key)} className={cls}>{inner}</button>
          );
      })}
    </div>
  );
}
