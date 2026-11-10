import { useState } from 'react';
import { digitsOnly } from '../../ui';
import { FOCUS, LIST_CARD } from '../../ui/styles';
import type { OwnCopy } from './copy';
import { checkPages, fmtPg, type PageRange } from './pages';

/**
 * bd-snkn32.17 — grades 1–5 "Make my own": the book pages of the day she picked, ready to change. She may narrow them,
 * type her own, or add the next day's pages. Each change reports the range the bot will take, or null (OK waits).
 * Keyed by the day by its parent, so picking another day starts again from that day's pages.
 */
export function PagesBox({ C, start, day, next, onChange }: {
  C: OwnCopy;
  /** What the boxes start from: her pages from the address, else the day's own. */
  start: PageRange | null;
  day: PageRange | null;
  next: PageRange | null;
  onChange: (r: PageRange | null) => void;
}) {
  const [from, setFrom] = useState(start ? String(start.start) : '');
  const [to, setTo] = useState(start ? String(start.end) : '');
  const ok = checkPages(from, to, day);
  const set = (f: string, t: string) => { setFrom(f); setTo(t); onChange(checkPages(f, t, day)); };
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
      {next && (!ok || ok.end < next.end) ? (
        <button type="button" className={`min-h-[48px] rounded-2xl border border-[#d1d5db] text-[15px] font-semibold text-[#33374a] ${FOCUS}`}
          data-testid="own-pg-next" onClick={() => set(from || String(day?.start ?? next.start), String(next.end))}>
          {C.addNextDay(fmtPg(next))}
        </button>
      ) : null}
      {ok ? null : <p role="alert" className="text-[14px] font-semibold text-[#c8331f]" data-testid="own-pg-bad">{C.badPages}</p>}
    </div>
  );
}
