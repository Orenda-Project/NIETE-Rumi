import { useCopy } from "../../teacher/i18n";
import type { Card, ReasonCode } from "./api";
import { DISAGREE } from "./copy";

/**
 * bd-tbprit.8 — the top of one teacher's card, as Rifat's prototype draws it: the dark head (her name, the lesson,
 * date · Group, the % and marks), the pink banner (she doesn't agree; how many reasons, the voice note, when, which
 * time), and her reasons as pills in her own words. Nothing missing is made up: no group, no date, no score → left out.
 */

const ICON: Record<ReasonCode, string> = { score: "🔢", missed: "✋", wont_work: "🚫", unclear: "❓" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PKT_OFFSET_MS = 5 * 3600000;

/** "2 Oct, 7:12 pm" in Pakistan time (UTC+5, no DST) — the coaches' clock, whatever the device says. */
export function sentWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + PKT_OFFSET_MS);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h % 12 || 12}:${mm} ${h < 12 ? "am" : "pm"}`;
}

export function CardHead({ card }: { card: Card }) {
  const C = useCopy(DISAGREE);
  const { header } = card.view;
  const when = [header.date, card.group ? C.group(card.group) : null].filter(Boolean).join(" · ");
  return (
    <div data-testid="card-head" className="flex items-start gap-3 rounded-[18px] bg-[#2f3446] p-4 text-white">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[20px] font-extrabold" dir="auto">{card.teacher ?? header.name ?? C.dash}</span>
        {header.meta ? <span className="text-[14px] text-white/75" dir="auto">{header.meta}</span> : null}
        {when ? <span className="text-[14px] text-white/75">{when}</span> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span data-testid="card-pct" className="text-[28px] font-extrabold leading-none text-[#f2b51d]">
          {header.pct == null ? C.dash : `${header.pct}%`}
        </span>
        {header.marks != null && header.max != null ? (
          <span className="mt-1 text-[13px] text-white/75" dir="ltr">{header.marks} / {header.max}</span>
        ) : null}
      </div>
    </div>
  );
}

export function Banner({ card }: { card: Card }) {
  const C = useCopy(DISAGREE);
  const line = [
    C.reasonCount(card.reasons.length) + (card.noteUrl ? C.plusNote : ""),
    C.sentAt(sentWhen(card.createdAt)),
    C.nthTime(card.nth),
  ].join(" · ");
  return (
    <div data-testid="card-banner" className="flex flex-col gap-1 rounded-[14px] bg-[#fdece7] p-3 text-[#b8432a]">
      <span className="text-[15px] font-bold" dir="auto">{C.disagrees(card.teacher ?? card.view.header.name ?? C.dash)}</span>
      <span className="text-[14px]">{line}</span>
    </div>
  );
}

export function ReasonPills({ reasons }: { reasons: ReasonCode[] }) {
  const C = useCopy(DISAGREE);
  return (
    <div className="flex flex-wrap gap-2">
      {reasons.map((r) => (
        <span key={r} data-testid="reason-pill" className="rounded-full border border-[#c2552f] bg-white px-3 py-1 text-[14px] font-bold text-[#b8432a]">
          {ICON[r]} {C.reason[r]}
        </span>
      ))}
    </div>
  );
}
