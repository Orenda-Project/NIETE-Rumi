import { cn } from '@/lib/utils';
import { FOCUS } from '../ui/styles';

/**
 * bd-6clakk.12 — under a type on a topic paper, the wording (stems) she may tick for its questions. "Rumi chooses" is
 * pressed while none is ticked, and pressing it clears hers. The stem text is data from the bot, not copy.
 */
export function StemChips({
  label, groupLabel, rumiChooses, stems, picked, onChange,
}: {
  label: string;
  groupLabel: string;
  rumiChooses: string;
  stems: Array<{ id: string; text: string }>;
  picked: string[];
  onChange: (ids: string[]) => void;
}) {
  const chip = (on: boolean) => cn(
    'min-h-[40px] rounded-full border px-3 py-1.5 text-start text-[14px] font-semibold leading-snug',
    on ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#33374a]',
    FOCUS,
  );
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div role="group" aria-label={groupLabel} className="border-t border-[#f0f1f3] bg-[#f4f5f8] px-3.5 pb-3 pt-2">
      <p className="mb-2 text-[13px] font-semibold text-[#6b7280]">{label}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={picked.length === 0} onClick={() => onChange([])} className={chip(picked.length === 0)}>
          {rumiChooses}
        </button>
        {stems.map((s) => (
          <button key={s.id} type="button" aria-pressed={picked.includes(s.id)} onClick={() => toggle(s.id)} className={chip(picked.includes(s.id))}>
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}
