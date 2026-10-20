import { useState } from "react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { FOCUS, ROW_SUB } from "../../teacher/ui/styles";
import type { Move } from "./api";
import { DISAGREE } from "./copy";
import { QUOTE } from "./cardParts";
import { halves, markOf, mostMissed, moveTotals, stepsOf, type Mark, type Step } from "./sections";

/**
 * bd-tbprit.9 — Lesson Plan Fidelity as Rifat asked (20 Oct): the plan's moves only, no B indicators.
 * Three numbers (moves in her plan, moves she did with Partial = ½, % done), a Yes / Partial / No bar, then the
 * steps with their own counts; the most-missed step opens first. Each move ✓ / ½ / ✗ (? when not recorded,
 * not counted), ★ on a key move, and one why line under each Partial or No.
 */

const GLYPH: Record<Mark, string> = { yes: "✓", partial: "½", no: "✗", unknown: "?" };
const TONE: Record<Mark, string> = {
  yes: "bg-[#e3f4ea] text-[#1f7a46]",
  partial: "bg-[#fdf1d8] text-[#9a6200]",
  no: "bg-[#fde3e0] text-[#c8331f]",
  unknown: "bg-[#eef0f3] text-[#5b6472]",
};
const BAR: Record<"yes" | "partial" | "no", string> = { yes: "bg-[#2e9d5b]", partial: "bg-[#e9a919]", no: "bg-[#d9473a]" };

function Tile({ testId, value, label }: { testId: string; value: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-xl border border-[#e1e4ea] bg-white p-2.5 text-center">
      <span data-testid={testId} className="text-[22px] font-extrabold text-[#1d2025]">{value}</span>
      <span className="text-[12.5px] leading-tight text-[#5b6472]">{label}</span>
    </div>
  );
}

function MoveLine({ move }: { move: Move }) {
  const C = useCopy(DISAGREE).where;
  const mark = markOf(move.verdict);
  const why = mark === "partial" || mark === "no" ? move.why ?? move.evidence : null;
  return (
    <li className="flex gap-2.5">
      <span data-testid="move-mark" data-mark={mark} aria-hidden="true"
        className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold", TONE[mark])}>{GLYPH[mark]}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span dir="auto" className="text-[15px] text-[#1d2025]">{move.mustHappen ? `★ ${move.text}` : move.text}</span>
        {mark === "unknown" ? <span className={ROW_SUB}>{C.notRecorded}</span> : null}
        {why ? <span dir="auto" className={QUOTE}>{why}</span> : null}
      </div>
    </li>
  );
}

function StepRow({ step, worst, open, onToggle }: { step: Step; worst: boolean; open: boolean; onToggle: () => void }) {
  const C = useCopy(DISAGREE).where;
  return (
    <li data-testid={`step-${step.name}`} className={cn("rounded-xl border", worst ? "border-[#f3b8b0] bg-[#fff7f6]" : "border-[#e1e4ea]")}>
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn("flex w-full items-center gap-2 px-3 py-2.5 text-start", FOCUS)}>
        <span dir="auto" className="flex-1 text-[15px] font-bold text-[#1d2025]">{step.name}</span>
        {worst ? <span className="rounded-full bg-[#fde3e0] px-2 py-0.5 text-[12px] font-bold text-[#c8331f]">{C.mostMissed}</span> : null}
        <span className="text-[14px] font-semibold text-[#374151]">{step.of ? `${halves(step.got)} / ${step.of}` : "—"}</span>
      </button>
      {open ? <ul className="flex flex-col gap-2.5 px-3 pb-3">{step.moves.map((m) => <MoveLine key={m.id} move={m} />)}</ul> : null}
    </li>
  );
}

export function PlanMoves({ moves }: { moves: Move[] }) {
  const C = useCopy(DISAGREE).where;
  const steps = stepsOf(moves);
  const worst = mostMissed(steps);
  const [open, setOpen] = useState<Set<string>>(() => new Set(worst ? [worst.name] : []));
  const t = moveTotals(moves);
  const toggle = (name: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Tile testId="mv-total" value={String(t.total)} label={C.mvTotal} />
        <Tile testId="mv-done" value={halves(t.done)} label={C.mvDone} />
        <Tile testId="mv-pct" value={t.pct == null ? "—" : `${t.pct}%`} label={C.mvPct} />
      </div>
      {t.total ? (
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[#eef0f3]" aria-hidden="true">
          {(["yes", "partial", "no"] as const).map((k) => (t[k] ? <span key={k} className={BAR[k]} style={{ width: `${(t[k] / t.total) * 100}%` }} /> : null))}
        </div>
      ) : null}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[#374151]">
        <span>{`${t.yes} ${C.yes}`}</span>
        <span>{`${t.partial} ${C.partial}`}</span>
        <span>{`${t.no} ${C.no}`}</span>
        <span>{C.key}</span>
      </p>
      <ul className="flex flex-col gap-2">
        {steps.map((s) => <StepRow key={s.name} step={s} worst={s === worst} open={open.has(s.name)} onToggle={() => toggle(s.name)} />)}
      </ul>
    </div>
  );
}
