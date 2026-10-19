import { createContext, useContext, useState, type ReactNode } from "react";
import { FileText, Headphones, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { AudioPlayer } from "../../newui/AudioPlayer";
import { Fold } from "../../newui/Panel";
import { FOCUS, OUTLINE_WIDE, ROW_SUB } from "../../teacher/ui/styles";
import { disagreements, type Card, type Evidence, type Indicator, type Item, type Move } from "./api";
import { DISAGREE } from "./copy";

/**
 * bd-tbprit.3 — the pieces of one teacher's card: a grader item (indicator, AI score out of 4, its quote, Listen),
 * a reason with its evidence, Where to look (the four sections, closed) and the full DC report.
 *
 * Listen opens the kit player on the server-cut clip under that item; one item open at a time.
 */

const INDICATOR_MAX = 4;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Clip = { id: string; open: string | null; setOpen: (k: string | null) => void };
const ClipContext = createContext<Clip>({ id: "", open: null, setOpen: () => {} });

export function ClipProvider({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return <ClipContext.Provider value={{ id, open, setOpen }}>{children}</ClipContext.Provider>;
}

function Listen({ k, at }: { k: string; at: number | null }) {
  const C = useCopy(DISAGREE);
  const clip = useContext(ClipContext);
  if (at == null) return null;
  if (clip.open === k) {
    return <AudioPlayer src={disagreements.clipUrl(clip.id, at)} label={C.clipLabel} bare testId="disagreement-clip" />;
  }
  return (
    <button type="button" onClick={() => clip.setOpen(k)} className={cn(OUTLINE_WIDE, FOCUS)}>
      <Headphones className="h-5 w-5" aria-hidden="true" />
      {C.listen} {clock(at)}
    </button>
  );
}

const QUOTE = "text-[14px] leading-[1.5] text-[#374151] rtl:leading-[2]";

export function ItemRow({ item, k }: { item: Item; k: string }) {
  const C = useCopy(DISAGREE);
  return (
    <li className="flex flex-col gap-1.5 border-t border-[#f0f1f3] pt-2.5 first:border-t-0 first:pt-0">
      <span className="text-[15px] font-semibold text-[#1d2025]">{item.name}</span>
      <span className={ROW_SUB}>{item.score == null ? C.dash : C.aiOf(item.score, INDICATOR_MAX)}</span>
      {item.evidence ? <q dir="auto" className={QUOTE}>{item.evidence}</q> : null}
      <Listen k={k} at={item.at} />
    </li>
  );
}

function MoveRow({ move, k }: { move: Move; k: string }) {
  return (
    <li className="flex flex-col gap-1.5 border-t border-[#f0f1f3] pt-2.5 first:border-t-0 first:pt-0">
      <span className="text-[15px] font-semibold text-[#1d2025]" dir="auto">{move.text}</span>
      {move.verdict ? <span className={ROW_SUB}>{move.verdict}</span> : null}
      {move.evidence ? <q dir="auto" className={QUOTE}>{move.evidence}</q> : null}
      <Listen k={k} at={move.at} />
    </li>
  );
}

const Items = ({ items, prefix }: { items: Item[]; prefix: string }) =>
  items.length ? <ul className="flex flex-col gap-2.5">{items.map((i) => <ItemRow key={i.id} item={i} k={`${prefix}:${i.id}`} />)}</ul> : null;

export function ReasonBlock({ e }: { e: Evidence }) {
  const C = useCopy(DISAGREE);
  let body: ReactNode;
  if (e.code === "score") {
    body = <Items items={e.items} prefix="score" />;
  } else if (e.code === "missed") {
    body = (
      <>
        {e.noPlan ? <p className={ROW_SUB}>{C.planNotChecked}</p> : null}
        {e.moves.length ? <ul className="flex flex-col gap-2.5">{e.moves.map((m) => <MoveRow key={m.id} move={m} k={`missed:${m.id}`} />)}</ul> : null}
        <Items items={e.items} prefix="missed" />
      </>
    );
  } else {
    body = (
      <>
        <p className={ROW_SUB}>{C.reportSaid}</p>
        <p dir="auto" className="text-[15px] text-[#1d2025]">{e.thing ? e.thing.text : C.dash}</p>
        {e.thing?.why ? <p dir="auto" className={QUOTE}>{e.thing.why}</p> : null}
      </>
    );
  }
  return (
    <section data-testid={`reason-${e.code}`} className="flex flex-col gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white p-4">
      <h3 className="text-[16px] font-bold text-[#1d2025]">{C.reason[e.code]}</h3>
      {body}
    </section>
  );
}

function indicatorTitle(ind: Indicator, C: typeof DISAGREE.en): string {
  const name = (C.sectionName as Record<string, string>)[ind.key] ?? ind.key;
  if (!ind.counted) return `${name} · ${ind.key === "lesson_plan_fidelity" ? C.planNotChecked : C.dash}`;
  return ind.score == null || ind.max == null ? `${name} · ${C.dash}` : `${name} · ${C.aiOf(ind.score, ind.max)}`;
}

export function WhereToLook({ card }: { card: Card }) {
  const C = useCopy(DISAGREE);
  return (
    <div data-testid="where-to-look" className="flex flex-col gap-2.5">
      <h2 className="text-[17px] font-bold text-[#1d2025]">{C.whereToLook}</h2>
      {card.indicators.map((ind) => (
        <Fold key={ind.key} icon={Search} title={indicatorTitle(ind, C)}>
          {ind.key === "lesson_plan_fidelity" && card.moves?.length ? (
            <>
              <p className={ROW_SUB}>{C.planSteps}</p>
              <ul className="mb-3 flex flex-col gap-2.5">{card.moves.map((m) => <MoveRow key={m.id} move={m} k={`plan:${m.id}`} />)}</ul>
            </>
          ) : null}
          {ind.items.length ? <Items items={ind.items} prefix={`where:${ind.key}`} /> : <p className={ROW_SUB}>{C.dash}</p>}
        </Fold>
      ))}
    </div>
  );
}

export function FullReport({ card }: { card: Card }) {
  const C = useCopy(DISAGREE);
  const { header, wells, thing, sections } = card.view;
  return (
    <Fold icon={FileText} title={C.fullReport} testId="full-report">
      <div className="flex flex-col gap-3">
        <p className="text-[16px] font-semibold">{header.pct == null ? C.dash : C.aiPct(header.pct)}</p>
        {header.meta || header.date ? <p className={ROW_SUB} dir="auto">{[header.meta, header.date].filter(Boolean).join(" · ")}</p> : null}
        <div>
          <p className={ROW_SUB}>{C.didWell}</p>
          {wells.length ? <ul className="list-disc ps-5">{wells.map((w) => <li key={w} dir="auto">{w}</li>)}</ul> : <p>{C.dash}</p>}
        </div>
        <div>
          <p className={ROW_SUB}>{C.thingToTry}</p>
          <p dir="auto">{thing ? thing.text : C.dash}</p>
          {thing?.why ? <p dir="auto" className={QUOTE}>{thing.why}</p> : null}
        </div>
        <ul className="flex flex-col gap-1.5">
          {sections.map((s) => (
            <li key={s.key} className="flex justify-between gap-3">
              <span dir="auto">{s.name}</span>
              <span className={ROW_SUB}>{s.notAssessed || s.score == null || s.max == null ? C.dash : C.aiOf(s.score, s.max)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Fold>
  );
}
