import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import { FOCUS } from './styles';
import { useKitCopy } from './useKitCopy';
import type { TeacherUiCopy } from './copy';

/**
 * bd-4404s7.1 — ChosenSoFar: what she has chosen so far in a multi-step flow. The choice is PLAIN TEXT (a small label, the
 * value, an optional second line): no card, no edge, no chevron, so it cannot be mistaken for something to press. Changing
 * it is a separate, clearly bordered Change button, a 56px target (operator, 9 Oct: information never looks like a button).
 * Rows are 64px at least, divided by a hairline. `onChange` makes Change a button; `to` makes it a link.
 * Canvas: ChosenSoFar board (New visit 2 and 3).
 */
export interface ChosenItem {
  /** "School", "Teacher" (the screen's word). */
  label: string;
  /** Data as it comes ("IMSG I-10/1"). */
  value: string;
  /** A second line, data too ("0399 0000123"). */
  sub?: string;
  to?: string;
  onChange?: () => void;
}

export interface ChosenSoFarProps {
  items: readonly ChosenItem[];
  /** The group's name for a screen reader (default "Chosen so far"). */
  heading?: string;
  copy?: Partial<Pick<TeacherUiCopy, 'change' | 'chosenSoFar'>>;
  className?: string;
}

const PILL = 'inline-flex h-9 items-center rounded-full border-[1.5px] border-[#c7cad6] bg-white px-3.5 text-[14px] font-semibold text-[#33374a]';
const TARGET = cn('flex min-h-[56px] shrink-0 items-center justify-center px-0.5 text-[#33374a]', FOCUS);

export function ChosenSoFar({ items, heading, copy, className }: ChosenSoFarProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  return (
    <section aria-label={heading ?? words.chosenSoFar} className={cn('w-full', className)}>
      {items.map((it, i) => {
        const name = `${words.change} ${it.label}`;
        const pill = <span data-change-pill className={PILL}>{words.change}</span>;
        return (
          <div key={`${it.label}-${i}`} className={cn('flex min-h-16 items-center gap-3 px-1 py-1.5', i > 0 && 'border-t border-[#e5e7eb]')}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold leading-[1.3] text-[#6b7280]">{it.label}</span>
              <span className="text-[17px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{bidi(it.value)}</span>
              {it.sub ? <span className="text-[13px] leading-[1.3] text-[#6b7280]">{bidi(it.sub)}</span> : null}
            </span>
            {it.to
              ? <Link to={it.to} aria-label={name} className={TARGET}>{pill}</Link>
              : <button type="button" aria-label={name} onClick={it.onChange} className={TARGET}>{pill}</button>}
          </div>
        );
      })}
    </section>
  );
}
