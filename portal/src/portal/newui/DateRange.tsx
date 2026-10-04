import { useEffect, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KIT_COPY } from './copy';
import { isIsoDate, pkToday, rangeLabel, RANGE_PRESETS, shortDate, type DateRange, type DateRangeCopy, type RangePreset } from './range';
import { Chip } from './Chip';
import { List, Row } from './List';
import { Sheet } from './Sheet';
import { ToggleList } from './ToggleList';
import { BottomButton } from './BottomButton';
import { FOCUS, TAP } from './styles';

/**
 * bd-5rz1v.19 — the date range on Home and its lists (deep-screens.html `.rangebtn` and the
 * "Date range" sheet): This week · This month · Last 3 months · This year · All time · Pick dates.
 * The values (keys, labels, the API query) are in range.ts.
 *
 * A preset applies at once and closes the sheet: one tap. Pick dates opens two date fields and
 * a Done button that waits for two dates in order.
 */

export interface DateRangeButtonProps {
  value: DateRange;
  onClick: () => void;
  /** On the indigo band (default) or on a light page. */
  surface?: 'band' | 'light';
  copy?: DateRangeCopy;
}

export function DateRangeButton({ value, onClick, surface = 'band', copy = KIT_COPY.dateRange }: DateRangeButtonProps) {
  const label = rangeLabel(value, copy);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`${copy.title}: ${label}`}
      className={cn('-my-2.5 flex items-center rounded-xl', TAP, FOCUS)}
    >
      <span
        data-pill
        className={cn(
          'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl border-[1.5px] px-3 text-[13.5px] font-bold rtl:font-semibold',
          surface === 'band'
            ? 'border-nu-frame-control-border bg-nu-frame-control text-white'
            : 'border-nu-surface-line bg-nu-surface-card text-nu-surface-text active:bg-nu-ink-xlight',
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </span>
    </button>
  );
}

export interface DateRangeSheetProps {
  open: boolean;
  value: DateRange;
  onChange: (range: DateRange) => void;
  onClose: () => void;
  /** The latest date she can pick, YYYY-MM-DD (default: today in Pakistan). */
  today?: string;
  copy?: DateRangeCopy;
  closeLabel?: string;
}

export function DateRangeSheet({ open, value, onChange, onClose, today, copy = KIT_COPY.dateRange, closeLabel }: DateRangeSheetProps) {
  const custom = value.key === 'custom' ? value : null;
  const [picking, setPicking] = useState(Boolean(custom));
  const [from, setFrom] = useState(custom?.from ?? '');
  const [to, setTo] = useState(custom?.to ?? '');
  const max = today ?? pkToday();

  // Each opening starts from what is applied, not from a half-typed pick that was abandoned.
  // Keyed on the range's contents: a parent that builds a new object each render must not wipe
  // what she is typing.
  const applied = custom ? `custom:${custom.from}:${custom.to}` : value.key;
  useEffect(() => {
    if (!open) return;
    const [key, f = '', t = ''] = applied.split(':');
    setPicking(key === 'custom');
    setFrom(f);
    setTo(t);
  }, [open, applied]);

  const valid = isIsoDate(from) && isIsoDate(to) && from <= to && to <= max;
  const choose = (key: RangePreset) => { onChange({ key }); onClose(); };
  const apply = () => { if (valid) { onChange({ key: 'custom', from, to }); onClose(); } };
  const field = 'min-h-[56px] min-w-0 flex-1 bg-transparent text-base font-bold text-nu-surface-text outline-none';

  return (
    <Sheet open={open} title={copy.title} onClose={onClose} closeLabel={closeLabel}>
      <ToggleList
        compact
        label={copy.title}
        options={RANGE_PRESETS.map((key) => ({ key, label: copy.presets[key] }))}
        value={value.key === 'custom' ? null : value.key}
        onChange={choose}
      />
      <List>
        <Row
          icon={CalendarDays}
          title={copy.pick}
          state={custom ? 'selected' : undefined}
          onClick={() => setPicking(true)}
          chips={(
            <>
              <Chip>{from ? shortDate(from) : copy.from}</Chip>
              <Chip>{to ? shortDate(to) : copy.to}</Chip>
            </>
          )}
        />
      </List>
      {picking ? (
        <div className="flex flex-col gap-2.5">
          {([['from', from, setFrom, undefined], ['to', to, setTo, from || undefined]] as const).map(([which, v, set, min]) => (
            <label
              key={which}
              className="flex items-center gap-3 rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card px-3.5 focus-within:ring-[3px] focus-within:ring-nu-focus"
            >
              <span className="w-14 shrink-0 text-sm font-extrabold text-nu-surface-muted">{copy[which]}</span>
              <input type="date" value={v} min={min} max={max} onChange={(e) => set(e.target.value)} className={field} />
            </label>
          ))}
          <BottomButton disabled={!valid} onClick={apply}>{copy.done}</BottomButton>
        </div>
      ) : null}
    </Sheet>
  );
}
