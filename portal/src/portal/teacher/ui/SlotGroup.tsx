import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { FOCUS } from './styles';
import { StatusChip } from './StatusChip';
import { TimeStamp } from './TimeStamp';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — SlotGroup: one time of day that opens to the visits booked at it (the coach's Team schedule: 20 at a slot is
 * normal). A white card whose 64px header is a toggle: the time (TimeStamp 18px), a count chip ("20 visits"), a small stack of
 * avatars while it is closed (+N for the rest), and a chevron. Open, it lists the first `limit` (4) as rows (a 36px avatar with
 * her initials, name, a second line, a green check when done) with a full-width "Show all 20" that expands the rest in place.
 * The coach's own row has the dark "You" avatar. A person with `to` is a link. Canvas: Coach_Team.
 */
export interface SlotPerson {
  id: string | number;
  name: string;
  /** "IMSG G-10/2 · Asma Khan". */
  sub?: string;
  /** Avatar letters; default the initials of `name`. */
  initials?: string;
  /** The signed-in coach's own visit: the dark "You" avatar. */
  mine?: boolean;
  done?: boolean;
  to?: string;
}

export interface SlotGroupProps {
  time: string;
  /** The slot's total (can be more than `people`); default `people.length`. */
  count?: number;
  people: readonly SlotPerson[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Rows shown before Show all (4). */
  limit?: number;
  copy?: Partial<Pick<TeacherUiCopy, 'visitsN' | 'showAllN' | 'showFewer' | 'you' | 'doneWord'>>;
  className?: string;
}

const initialsOf = (name: string): string => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return w.length ? (Array.from(w[0])[0] + (w.length > 1 ? Array.from(w[w.length - 1])[0] : '')).toUpperCase() : '·';
};

function Avatar({ p, size, you, className }: { p: SlotPerson; size: 'sm' | 'md'; you: string; className?: string }) {
  return (
    <span
      data-avatar
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold',
        size === 'sm' ? 'h-[30px] min-w-[30px] border-2 border-white px-0.5 text-[10px]' : 'h-9 w-9 text-[12px]',
        p.mine ? 'bg-[#33374a] text-white' : 'bg-[#e8e9f0] text-[#33374a]',
        className,
      )}
    >
      {p.mine ? you : (p.initials ?? initialsOf(p.name))}
    </span>
  );
}

export function SlotGroup({ time, count, people, open, defaultOpen = false, onOpenChange, limit = 4, copy, className }: SlotGroupProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const [inner, setInner] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const isOpen = open ?? inner;
  const total = count ?? people.length;
  const toggle = () => { setInner(!isOpen); onOpenChange?.(!isOpen); };
  const shown = all ? people : people.slice(0, limit);
  const preview = people.slice(0, 2);
  const more = Math.max(0, total - preview.length);
  return (
    <section className={cn('overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-label={`${time}, ${words.visitsN(total)}`}
        className={cn('flex min-h-16 w-full items-center gap-3 px-3.5 py-2 text-start', FOCUS)}
      >
        <span className="min-w-[86px]"><TimeStamp time={time} size={18} /></span>
        <StatusChip text={words.visitsN(total)} tone="info" className="h-7 font-bold" />
        <span className="flex flex-1 items-center justify-end ps-2">
          {!isOpen ? (
            <>
              {preview.map((p) => <Avatar key={p.id} p={p} size="sm" you={words.you} className="-ms-2 first:ms-0" />)}
              {more > 0 ? <span data-avatar aria-hidden="true" className="-ms-2 flex h-[30px] min-w-[30px] items-center justify-center rounded-full border-2 border-white bg-[#e8e9f0] px-1 text-[10px] font-bold text-[#33374a]">{`+${more}`}</span> : null}
            </>
          ) : null}
        </span>
        <ChevronDown className={cn('h-[22px] w-[22px] shrink-0 text-[#9ca3af]', isOpen && 'rotate-180')} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {isOpen ? (
        <>
          {shown.map((p) => {
            const body = (
              <>
                <Avatar p={p} size="md" you={words.you} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{bidi(p.name)}</span>
                  {p.sub ? <span className="text-[12px] leading-[1.3] text-[#6b7280]">{bidi(p.sub)}</span> : null}
                </span>
                {p.done ? <Check role="img" aria-label={words.doneWord} className="h-5 w-5 shrink-0 text-[#48b078]" strokeWidth={2.6} /> : null}
              </>
            );
            const frame = 'flex min-h-[60px] w-full items-center gap-3 border-t border-[#eef0f3] px-3.5 py-2 text-start';
            return p.to
              ? <Link key={p.id} to={p.to} className={cn(frame, FOCUS)}>{body}</Link>
              : <div key={p.id} className={frame}>{body}</div>;
          })}
          {people.length > limit || total > people.length ? (
            <button
              type="button"
              onClick={() => setAll(!all)}
              className={cn('flex min-h-[56px] w-full items-center justify-center gap-1.5 border-t border-[#eef0f3] bg-[#f9fafb] text-[15px] font-semibold text-[#33374a]', FOCUS)}
            >
              {all ? words.showFewer : words.showAllN(total)}
              <ChevronDown className={cn('h-[18px] w-[18px]', all && 'rotate-180')} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
