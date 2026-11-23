import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui";
import { CHEVRON, FOCUS, GRID, LIST_CARD, ROW_DIVIDER } from "../../teacher/ui/styles";
import { FORM_V7, type FormV7Copy } from "../flow/copyV7form";
import { PartTitle, urduOf } from "./FormV7";

/**
 * bd-o15qnr.40.6 (queue #229, the operator 23 Nov ~15:50: "why is 6-12 so different looking than the 1-5 one? Can they be
 * the same?") — the Feedback Form's v7 navigation pieces, ONE set for every rubric: FICO17 v6 (FormV7List.tsx) and
 * FICO-S (Obs612Form.tsx) draw their sections, a section's indicators and one indicator with these, so the two forms look
 * and move the same; only the rubric's content differs. Moved here from FormV7List.tsx unchanged (bd-o15qnr.31's boards
 * ff-outer, ff-list, ff-detail).
 *
 *   SectionList     every section as a row: a green tick or a yellow dot, "B. Title", "n/m done", ›
 *   SectionChips    the sections as chips over a section (green or yellow, n/m), the open one ringed
 *   SectionHead     a section's title, "n of m checked" and its progress strip
 *   IndicatorRow    one indicator in a section: its mark, code chip, name, one muted line, its level chip, ›
 *   IndicatorNav    one indicator's header: Previous, the code chip and the name, Next
 */

const GREEN = "bg-[#48b078]";
const YELLOW = "bg-[#f5c542]";
const SR = "sr-only";

/** A green tick or a yellow dot; the words for a screen reader come from the row. */
export function Mark({ done, size = 22 }: { done: boolean; size?: number }) {
  return (
    <span aria-hidden="true" data-mark={done ? "done" : "todo"} style={{ width: size, height: size }}
      className={cn("flex shrink-0 items-center justify-center rounded-full text-white", done ? GREEN : YELLOW)}>
      {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

export type SectionInfo = { flags: boolean[]; done: number; total: number; complete: boolean };
export type SectionItem = { key: string; title: string; info: SectionInfo };

/** The outer view: every section as a row. */
export function SectionList({ items, onOpen }: { items: SectionItem[]; onOpen: (key: string) => void }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <div data-testid="ff-sections" className="flex flex-col gap-2.5">
      {items.map((s) => (
        <button key={s.key} id={`ff-sec-${s.key}`} type="button" onClick={() => onOpen(s.key)}
          className={cn(LIST_CARD, "flex min-h-[64px] w-full items-center gap-3 px-3.5 text-start", FOCUS)}>
          <Mark done={s.info.complete} size={16} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
            <span className="text-[16px] font-semibold leading-[1.3]" dir="auto">{s.title}</span>
            <span className="text-[13px] leading-[1.3] text-[#6b7280]">{F.doneOf(s.info.done, s.info.total)}</span>
          </span>
          <span className={SR}>{s.info.complete ? F.markDone : F.markTodo}</span>
          <ChevronRight className={cn("h-5 w-5", CHEVRON)} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** The sections as chips over a section; `short` is what the chip says (the section's letter). */
export function SectionChips({ items, current, onOpen }: { items: (SectionItem & { short: string })[]; current: string; onOpen: (key: string) => void }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <div data-testid="ff-chips" className={cn(GRID, "grid-cols-4 gap-1.5")}>
      {items.map((s) => {
        const on = s.key === current;
        return (
          <button key={s.key} type="button" data-mark={s.info.complete ? "done" : "todo"} aria-current={on ? true : undefined}
            aria-label={`${s.short} ${s.info.done}/${s.info.total}, ${s.info.complete ? F.markDone : F.markTodo}`}
            onClick={() => onOpen(s.key)}
            className={cn("flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl border text-[13px] font-bold",
              s.info.complete ? "border-[#48b078] bg-[#eaf6ef] text-[#1f5f3d]" : "border-[#f5c542] bg-[#fff7d6] text-[#7a5b00]",
              on && "shadow-[0_0_0_2px_#33374a]", FOCUS)}>
            {s.short}
            <small dir="ltr" className="text-[11px] font-semibold opacity-90">{`${s.info.done}/${s.info.total}`}</small>
          </button>
        );
      })}
    </div>
  );
}

/** A section's title, "n of m checked" and its strip. */
export function SectionHead({ title, info }: { title: string; info: SectionInfo }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <>
      <PartTitle text={title} />
      <span className="px-1 text-[13px] font-bold text-[#6b7280]">{F.checkedOf(info.done, info.total)}</span>
      {info.total > 0 ? (
        <div aria-hidden="true" className="flex gap-[3px] px-1">
          {info.flags.map((f, i) => <i key={i} className={cn("h-1.5 flex-1 rounded-[3px]", f ? GREEN : "bg-[#e5e7eb]")} />)}
        </div>
      ) : null}
    </>
  );
}

/** One indicator in a section's list. `words`: its level's words, or none (then "Yours to set"). */
export function IndicatorRow({ code, name, line, words, done, first, onOpen }: {
  code: string; name: string; line?: string | null; words: string | null; done: boolean; first: boolean; onOpen: () => void;
}) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <button type="button" data-testid="ff-row" onClick={onOpen}
      className={cn("flex min-h-[68px] w-full items-center gap-2.5 px-3.5 py-2 text-start", !first && ROW_DIVIDER, FOCUS)}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex h-6 min-w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[#e8e9f0] px-1.5 text-[12px] font-bold text-[#33374a]">{code}</span>
          <span className="min-w-0 truncate text-[15px] font-semibold leading-[1.3]" dir="auto">{name}</span>
        </span>
        {line ? <span className="truncate text-[13px] text-[#6b7280]" dir="auto" {...urduOf(line)}>{line}</span> : null}
      </span>
      {words ? <StatusChip text={words} tone="info" /> : <StatusChip text={F.yoursToSet} tone="waiting" />}
      <span className="order-first"><Mark done={done} /></span>
      <span className={SR}>{done ? F.markDone : F.markTodo}</span>
      <ChevronRight className={cn("h-5 w-5", CHEVRON)} aria-hidden="true" />
    </button>
  );
}

/** A section's indicators in one card. */
export function IndicatorRows({ children }: { children: ReactNode }) {
  return <section className={LIST_CARD}>{children}</section>;
}

/**
 * One indicator's header (bd-o15qnr.35, the operator 21 Nov ~12:58: the code and the name between Previous and Next, two
 * lines at most, not again inside the card).
 */
export function IndicatorNav({ code, name, index, count, onGo }: { code: string; name: string; index: number; count: number; onGo: (n: number) => void }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <div data-testid="ff-nav" className="flex items-center gap-2">
      <button type="button" aria-label={F.prevIndicator} disabled={index === 0} onClick={() => onGo(index - 1)}
        className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-[#33374a] disabled:opacity-40", FOCUS)}>
        <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <StatusChip text={code} tone="score" className="shrink-0" />
        <h3 className="m-0 line-clamp-2 min-w-0 flex-1 text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]" dir="auto">{name}</h3>
      </div>
      <button type="button" aria-label={F.nextIndicator} disabled={index >= count - 1} onClick={() => onGo(index + 1)}
        className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-[#33374a] disabled:opacity-40", FOCUS)}>
        <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
      </button>
    </div>
  );
}
