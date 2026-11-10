import { useState } from 'react';
import { digitsOnly } from '../../ui';
import { FOCUS, LIST_CARD } from '../../ui/styles';
import type { OwnCopy } from './copy';
import type { PageRange } from './pages';

/**
 * /.19 — "Book pages", for every band: From / To, starting at her pages or the lesson's, ready to change,
 * and "+ Add the next day's / lesson's pages". Each change reports what she typed; the parent's `valid` says whether
 * OK may go (the bot checks again). Keyed by the lesson by its parent, so another lesson starts from its own pages.
 */
export function PagesBox({ C, start, next, addLabel, badText, valid, onChange }: {
  C: OwnCopy;
  start: PageRange | null;
  next: PageRange | null;
  addLabel: string;
  badText: string;
  valid: (from: string, to: string) => boolean;
  onChange: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(start ? String(start.start) : '');
  const [to, setTo] = useState(start ? String(start.end) : '');
  const ok = valid(from, to);
  const set = (f: string, t: string) => { setFrom(f); setTo(t); onChange(f, t); };
  const box = `min-h-[48px] w-full rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] ${FOCUS}`;
  return (
    <div className={`${LIST_CARD} flex flex-col gap-3 p-4`} data-testid="own-pg-box">
      <div>
        <p className="text-[16px] font-semibold">{C.pages}</p>
        <p className="text-[13px] text-[#6b7280]">{C.pagesHint}</p>
      </div>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[13px] font-semibold text-[#4b5563]">{C.pageFrom}</span>
          <input inputMode="numeric" value={from} maxLength={3} className={box} data-testid="own-pg-from"
            onChange={(e) => set(digitsOnly(e.target.value), to)} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[13px] font-semibold text-[#4b5563]">{C.pageTo}</span>
          <input inputMode="numeric" value={to} maxLength={3} className={box} data-testid="own-pg-to"
            onChange={(e) => set(from, digitsOnly(e.target.value))} />
        </label>
      </div>
      <p className="text-[13px] text-[#6b7280]">{C.pagesOneHint}</p>
      {next && (!ok || Number(to) < next.end) ? (
        <button type="button" className={`min-h-[48px] rounded-2xl border border-[#d1d5db] text-[15px] font-semibold text-[#33374a] ${FOCUS}`}
          data-testid="own-pg-next" onClick={() => set(from || String(start?.start ?? next.start), String(next.end))}>
          {addLabel}
        </button>
      ) : null}
      {ok ? null : <p role="alert" className="text-[14px] font-semibold text-[#c8331f]" data-testid="own-pg-bad">{badText}</p>}
    </div>
  );
}
