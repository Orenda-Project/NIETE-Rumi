import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { FOCUS, ROW_SUB } from "../../teacher/ui/styles";
import type { Card, Indicator } from "./api";
import { DISAGREE } from "./copy";
import { clock, Items, Listen } from "./cardParts";
import { PlanMoves } from "./planMoves";
import { disputedKeys, indicatorCounts, isShort, lowestKey, problemPart } from "./sections";

/**
 * bd-tbprit.9 — Rifat's "B. Where to look" (prototype + her 20 Oct review):
 *
 *   the recording's length, and ONE Listen for the problem part only (start to end, cut by the server), with what
 *   to listen for; a part after the recording stopped gets the line, never a player; under 15 minutes, the short line
 *   then the four sections, closed, each with its score, a bar and the lowest / disputed tags.
 *   Lesson Plan Fidelity is the plan's moves (planMoves.tsx); the other three keep their indicators, AI score out of 4.
 *
 * The part is sections.ts problemPart: the most-missed step's span, else the DC's evidence times.
 */

const H2 = "text-[17px] font-bold text-[#1d2025]";
const TAG = "rounded-full px-2 py-0.5 text-[12px] font-bold";
const PLAN = "lesson_plan_fidelity";

function ProblemPart({ card }: { card: Card }) {
  const C = useCopy(DISAGREE).where;
  const { step, listenFor, part } = problemPart(card);
  const dur = card.durationSec ?? null;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#e1e4ea] bg-white p-4">
      {dur ? <p className={ROW_SUB}>{C.recording(clock(dur))}</p> : null}
      {part === "notRecorded" ? (
        <p role="note" className="text-[15px] font-semibold text-[#c8331f]">{C.notInRecording(clock(dur as number))}</p>
      ) : part ? (
        <>
          <Listen k="problem-part" at={part.from} to={part.to}
            label={step ? C.listenStep(step, clock(part.from), clock(part.to)) : C.listenPart(clock(part.from), clock(part.to))} />
          {listenFor ? <p dir="auto" className="text-[14px] text-[#374151]">{C.listenFor(listenFor)}</p> : null}
        </>
      ) : null}
      {isShort(dur) ? <p className="text-[14px] text-[#9a6200]">{C.short(Math.round((dur as number) / 60), clock(dur as number))}</p> : null}
    </div>
  );
}

function Section({ ind, tags, children }: { ind: Indicator; tags: ReactNode; children: ReactNode }) {
  const C = useCopy(DISAGREE);
  const [open, setOpen] = useState(false);
  const name = (C.sectionName as Record<string, string>)[ind.key] ?? ind.key;
  const scored = ind.counted && ind.score != null && ind.max;
  const pct = scored ? Math.round(((ind.score as number) * 100) / (ind.max as number)) : null;
  return (
    <section data-testid={`section-${ind.key}`} className="overflow-hidden rounded-2xl border-[1.5px] border-[#e1e4ea] bg-white">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={cn("flex w-full flex-col gap-1.5 px-4 py-3 text-start", FOCUS)}>
        <span className="flex w-full items-center gap-2">
          <span className="flex-1 text-[15.5px] font-extrabold text-[#1d2025]">{name}</span>
          <ChevronDown aria-hidden="true" className={cn("h-5 w-5 shrink-0 text-[#8a93a3]", open && "rotate-180")} />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-[#374151]">
            {scored ? `${ind.score} / ${ind.max} · ${pct}%` : ind.key === PLAN ? C.where.notChecked : C.dash}
          </span>
          {tags}
        </span>
        {pct != null ? (
          <span className="block h-2 w-full overflow-hidden rounded-full bg-[#eef0f3]" aria-hidden="true">
            <span className="block h-full bg-[#4f6bed]" style={{ width: `${pct}%` }} />
          </span>
        ) : null}
        {ind.key === PLAN && scored ? <span className={ROW_SUB}>{C.where.tapMoves}</span> : null}
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

function OtherSection({ ind }: { ind: Indicator }) {
  const C = useCopy(DISAGREE);
  if (!ind.items.length) return <p className={ROW_SUB}>{C.dash}</p>;
  const n = indicatorCounts(ind.items);
  return (
    <div className="flex flex-col gap-2.5">
      <p className={ROW_SUB}>{C.where.indicators(n.n, n.at, n.none)}</p>
      <Items items={ind.items} prefix={`where:${ind.key}`} />
    </div>
  );
}

export function WhereToLook({ card }: { card: Card }) {
  const C = useCopy(DISAGREE).where;
  const lowest = lowestKey(card.indicators);
  const disputed = disputedKeys(card);
  return (
    <div data-testid="where-to-look" className="flex flex-col gap-2.5">
      <h2 className={H2}>{C.title}</h2>
      <ProblemPart card={card} />
      <h3 className="text-[15px] font-bold text-[#1d2025]">{C.sections}</h3>
      <p className={ROW_SUB}>{C.sectionsHint}</p>
      {card.indicators.map((ind) => (
        <Section key={ind.key} ind={ind} tags={
          <>
            {disputed.has(ind.key) ? <span className={cn(TAG, "bg-[#fde3e0] text-[#c8331f]")}>{C.disputed}</span> : null}
            {lowest === ind.key ? <span className={cn(TAG, "bg-[#fdf1d8] text-[#9a6200]")}>{C.lowest}</span> : null}
          </>
        }>
          {ind.key === PLAN ? (card.moves?.length ? <PlanMoves moves={card.moves} /> : <p className={ROW_SUB}>{C.notChecked}</p>) : <OtherSection ind={ind} />}
        </Section>
      ))}
    </div>
  );
}
