import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { ListRow } from './ListRow';
import { FOCUS } from './styles';
import { Tray } from './Tray';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — SelectField: one field that opens a Tray of choices (the coach's school filter, coach filter, a school in Edit
 * teacher, the profile's school). A 68px card: a 44px tile (`icon`), what is chosen at 17px/600 (or the placeholder "Select")
 * with an optional second line, and a chevron; its label is the field's name for a screen reader and the first small line. The
 * Tray lists the options as 56px+ rows (the kit's ListRow), the picked one marked; a pick closes it. Built on `Tray` and
 * `ListRow`, so the sheet behaves like every other (Android Back, Escape, focus). Few choices, no search: a long list is grouped
 * by the screen, not searched here. Canvas: Coach_Team (All coaches), Coach_Pick (School), Coach_EditTeacher.
 */
export interface SelectOption {
  value: string;
  label: string;
  /** A second line ("6 coaches"). */
  sub?: string;
  /** bd-o15qnr.40.9 — the row's tile: a prefix over a number ("A" over "1" for indicator A1). Absent: as before. */
  prefix?: string;
  number?: string;
}

export interface SelectFieldProps {
  /** The field's name ("Coach", "School"). */
  label: string;
  /** The Tray's title ("Select coach"). */
  title: string;
  /** The chosen option's `value`; null / undefined = nothing chosen yet. */
  value: string | null | undefined;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** A 44px tile at the start (an icon in a grey square). */
  icon?: ReactNode;
  disabled?: boolean;
  copy?: Partial<Pick<TeacherUiCopy, 'select' | 'close'>>;
  className?: string;
  /**
   * Queue #256 — the option the Digital Coach picked (the FICO 6-12 Feedback Form's "Indicator to work on"): marked as
   * RatingScale's radio look marks its level — its row in the Tray edged purple with `dcTag` at the end, and the field
   * itself while that option is the one chosen. She can pick another; the mark stays on its row. Absent: as before.
   */
  dcValue?: string | null;
  /** The word for the mark ("Digital Coach"), drawn and read with the field and the row. */
  dcTag?: string;
}

export function SelectField({ label, title, value, options, onChange, icon, disabled = false, copy, className, dcValue = null, dcTag }: SelectFieldProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value) ?? null;
  const shown = chosen ? chosen.label : words.select;
  const isDc = (v: string) => !!dcTag && dcValue !== null && dcValue !== undefined && v === dcValue;
  const dcChosen = !!chosen && isDc(chosen.value);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={dcChosen ? `${label}, ${shown}, ${dcTag}` : `${label}, ${shown}`}
        className={cn(
          'flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-3 py-2.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)] disabled:opacity-45',
          dcChosen && 'border-[#6e52e0] shadow-[0_0_0_3px_#e9e3ff]',
          FOCUS,
          className,
        )}
      >
        {icon ? <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">{icon}</span> : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-semibold leading-[1.3] text-[#6b7280]">{label}</span>
          <span {...bidi.ltr(shown)} className={cn('text-[17px] font-semibold leading-[1.3] [overflow-wrap:anywhere]', !chosen && 'text-[#6b7280]')}>{bidi(shown)}</span>
          {chosen?.sub ? <span {...bidi.ltr(chosen.sub)} className="text-[13px] leading-[1.3] text-[#6b7280]">{bidi(chosen.sub)}</span> : null}
        </span>
        {dcChosen ? <span data-testid="dc-tag" aria-hidden="true" className="shrink-0 text-[12px] font-bold text-[#6e52e0]">{dcTag}</span> : null}
        <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#9ca3af]" strokeWidth={2.4} aria-hidden="true" />
      </button>
      <Tray open={open} title={title} onClose={() => setOpen(false)} closeLabel={words.close}>
        <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
          {options.map((o, i) => (
            <ListRow
              key={o.value}
              variant="row"
              first={i === 0}
              label={o.label}
              subtitle={o.sub}
              prefix={o.prefix}
              number={o.number}
              state={o.value === value ? 'selected' : 'default'}
              dcTag={isDc(o.value) ? dcTag : undefined}
              onPress={() => { onChange(o.value); setOpen(false); }}
            />
          ))}
        </div>
      </Tray>
    </>
  );
}
