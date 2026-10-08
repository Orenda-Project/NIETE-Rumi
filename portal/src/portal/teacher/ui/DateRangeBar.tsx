import { useRef, useState, type KeyboardEvent } from 'react';
import { Calendar, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_RANGE, RANGE_PRESETS, isIsoDate, pkToday, type DateRange, type RangePreset } from '../../newui/range';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { formatSpan, resolveRange, type ResolvedRange } from './range';
import { FOCUS } from './styles';
import { Tray } from './Tray';

/**
 * bd-fmf24g.2.3 — DateRangeBar (COMPONENTS.md §9): the range at the top of an All page. Operator: "a range
 * selector on top and some compiled KPIs". A 68px card button — a calendar tile, the range's name (17px/600)
 * over its dates (13px), ⌄ — opens a Tray: This week · This month (default) · Last 3 months · This year ·
 * All time · Pick dates, each a 64px row with its dates. A preset applies at once and closes the tray. Pick dates
 * shows From and To (labelled date fields, not after today) and Show, which waits for From ≤ To.
 *
 * The value is the portal's own DateRange (newui/range.ts), so `rangeQuery(range)` is the API's query as it already
 * is for Home. `onChange(range, info)`: info = the dates, the previous period (resolveRange) and `compareLabel`
 * ("vs 1 – 8 Sep 2026", "" for All time) — hand it to KpiTiles.
 */

export interface DateRangeInfo extends ResolvedRange {
  label: string;
  compareLabel: string;
}

export interface DateRangeBarProps {
  value?: DateRange;
  defaultValue?: DateRange;
  onChange?: (range: DateRange, info: DateRangeInfo) => void;
  /** YYYY-MM-DD; ranges end on it. Pakistan's today by default. */
  today?: string;
  copy?: Partial<Pick<TeacherUiCopy, 'dateRange' | 'presets' | 'pickDates' | 'pickedDates' | 'from' | 'to' | 'everything' | 'rangeError' | 'showDates' | 'showSpan' | 'compareWith' | 'months' | 'close'>>;
  className?: string;
}

type Choice = RangePreset | 'custom';
const CHOICES: Choice[] = [...RANGE_PRESETS, 'custom'];

export function DateRangeBar({ value, defaultValue = DEFAULT_RANGE, onChange, today, copy, className }: DateRangeBarProps) {
  const words = { ...useKitCopy(), ...copy };
  const day = today ?? pkToday();
  const [inner, setInner] = useState<DateRange>(defaultValue);
  const [tray, setTray] = useState<'' | 'presets' | 'dates'>('');
  const [draft, setDraft] = useState({ from: '', to: '' });
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  const current = value ?? inner;

  const labelOf = (r: DateRange) => (r.key === 'custom' ? words.pickedDates : words.presets[r.key]);
  const info = (r: DateRange): DateRangeInfo => {
    const res = resolveRange(r, day, words.months);
    return { ...res, label: labelOf(r), compareLabel: res.prevSpan ? words.compareWith(res.prevSpan) : '' };
  };
  const now = info(current);
  const commit = (r: DateRange) => {
    if (value === undefined) setInner(r);
    setTray('');
    onChange?.(r, info(r));
  };
  const startPicking = () => {
    setDraft({
      from: current.key === 'custom' ? current.from : now.from ?? `${day.slice(0, 8)}01`,
      to: current.key === 'custom' ? current.to : day,
    });
    setTray('dates');
  };
  const pick = (c: Choice) => (c === 'custom' ? startPicking() : commit({ key: c }));

  const bad = isIsoDate(draft.from) && isIsoDate(draft.to) && draft.from > draft.to;
  const ok = isIsoDate(draft.from) && isIsoDate(draft.to) && draft.from <= draft.to && draft.to <= day;

  // Up/down move the focus over the choices; a pick closes the tray, so an arrow never picks.
  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    rows.current[Math.max(0, Math.min(CHOICES.length - 1, next))]?.focus();
  };
  const picked: Choice = tray === 'dates' ? 'custom' : current.key;

  return (
    <div className={cn('w-full text-[#1d2025]', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!tray}
        onClick={() => setTray('presets')}
        className={cn(
          'flex w-full min-h-[68px] items-center gap-3 rounded-2xl bg-white py-2.5 pe-3.5 ps-2.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)]',
          tray ? 'border-2 border-[#33374a]' : 'border border-[#e5e7eb]',
          FOCUS,
        )}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">
          <Calendar className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[17px] font-semibold">{now.label}</span>
          <span className="text-[13px] font-semibold text-[#4b5563]">{now.span || words.everything}</span>
        </span>
        <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#4b5563]" strokeWidth={2.4} aria-hidden="true" />
      </button>

      <Tray open={!!tray} title={words.dateRange} onClose={() => setTray('')} closeLabel={words.close}>
        <div role="radiogroup" aria-label={words.dateRange} className="shrink-0 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
          {CHOICES.map((c, i) => {
            const on = c === picked;
            const label = c === 'custom' ? words.pickDates : words.presets[c];
            const span = c === 'custom'
              ? (current.key === 'custom' ? now.span : '')
              : (c === 'all' ? '' : resolveRange({ key: c }, day, words.months).span);
            return (
              <button
                key={c}
                ref={(el) => { rows.current[i] = el; }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={span ? `${label}, ${span}` : label}
                tabIndex={on ? 0 : -1}
                onClick={() => pick(c)}
                onKeyDown={(e) => onRowKey(e, i)}
                className={cn(
                  'flex w-full min-h-[64px] items-center gap-3 px-4 py-2.5 text-start',
                  i > 0 && 'border-t border-[#eef0f3]',
                  on ? 'bg-[#eef0f6]' : 'bg-white',
                  FOCUS,
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[17px] font-semibold">{label}</span>
                  {span ? <span className="text-[13px] font-semibold text-[#4b5563]">{span}</span> : null}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full',
                    on ? 'bg-[#33374a] text-white' : 'border-2 border-[#9ca3af] bg-white',
                  )}
                >
                  {on ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                </span>
              </button>
            );
          })}
        </div>

        {tray === 'dates' ? (
          <div className="flex shrink-0 flex-col gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3.5">
            <div className="[display:grid] grid-cols-2 gap-2.5">
              {(['from', 'to'] as const).map((k) => (
                <label key={k} className="flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-[#4b5563]">
                  {words[k]}
                  <input
                    type="date"
                    value={draft[k]}
                    max={day}
                    aria-invalid={bad}
                    onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                    className={cn('h-14 w-full min-w-0 rounded-xl border border-[#d1d5db] bg-white px-2.5 text-[16px] text-[#1d2025]', FOCUS)}
                  />
                </label>
              ))}
            </div>
            {bad ? <p role="alert" className="m-0 text-[14px] font-semibold text-[#b42318]">{words.rangeError}</p> : null}
            <button
              type="button"
              disabled={!ok}
              onClick={() => { if (ok) commit({ key: 'custom', from: draft.from, to: draft.to }); }}
              className={cn(
                'min-h-[56px] w-full rounded-[14px] text-[17px] font-semibold',
                ok ? 'bg-[#33374a] text-white' : 'cursor-default bg-[#e5e7eb] text-[#4b5563]',
                FOCUS,
              )}
            >
              {ok ? words.showSpan(formatSpan(draft.from, draft.to, words.months)) : words.showDates}
            </button>
          </div>
        ) : null}
      </Tray>
    </div>
  );
}
