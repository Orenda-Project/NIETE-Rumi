import { Bell } from 'lucide-react';
import { useBidi } from './bidi';

/**
 * bd-fmf24g.15 — LeaveNote (COMPONENTS.md §12): the line every waiting screen carries (a plan being prepared,
 * a paper being written) — "You can leave. We'll tell you here." — in a white card with a bell. The words are
 * the screen's: a sentence is not a kit label, and what the app promises is the screen's to say.
 */
export function LeaveNote({ text }: { text: string }) {
  const bidi = useBidi();
  return (
    <div role="note" className="flex w-full items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3.5 text-[#1d2025]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[#33374a]">
        <Bell className="h-5 w-5" aria-hidden="true" />
      </span>
      <span dir="auto" className="min-w-0 flex-1 text-[16px] font-medium leading-snug">{bidi(text)}</span>
    </div>
  );
}
