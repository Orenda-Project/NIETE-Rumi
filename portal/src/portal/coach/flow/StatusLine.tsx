import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { FLOW_V7, type FlowV7Copy } from "./copyV7";

/**
 * bd-o15qnr.28 (queue #204, v7) — the status line, option A (#188's LOCK round), on the visit and on every list card:
 * four segments (Analysed · Feedback Form · Debrief · Send), each with words that say whether the step happened:
 *
 *   done      green segment     Analysed / Form filled / Debriefed / Sent
 *   current   half orange       Analysing / Fill the form / Record the debrief / Send the report
 *   later     grey              Form to fill / Debrief to do / Yet to send
 *
 * Under it, "Now: <current>" in place of "Step n of 4"; all four done, "Done" with a tick. `at` is the visit's step:
 * 0 analysed … 3 send, 4 all done (CoachObservation's own index).
 */
export const STATUS_STEPS = 4;

export function stepWords(i: number, W: FlowV7Copy): { done: string; current: string; later: string } {
  return W.steps[i];
}

export function StatusLine({ at, className }: { at: number; className?: string }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const allDone = at >= STATUS_STEPS;
  const stateOf = (i: number) => (allDone || i < at ? "done" : i === at ? "current" : "later");
  return (
    <section data-testid="status-line" aria-label={allDone ? W.allDone : W.now(stepWords(at, W).current)} className={cn("flex flex-col gap-2", className)}>
      <ol className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
        {Array.from({ length: STATUS_STEPS }, (_, i) => {
          const state = stateOf(i);
          const words = stepWords(i, W);
          return (
            <li key={i} className="flex min-w-0 flex-col gap-1.5">
              <span data-testid="status-seg" data-state={state} aria-hidden="true"
                className={cn("h-2 rounded-full",
                  state === "done" && "bg-[#48b078]",
                  state === "current" && "bg-[linear-gradient(90deg,#f59e0b_50%,#e5e7eb_50%)] rtl:bg-[linear-gradient(270deg,#f59e0b_50%,#e5e7eb_50%)]",
                  state === "later" && "bg-[#e5e7eb]")} />
              <span data-testid="status-label"
                className={cn("text-[12px] leading-[1.25] rtl:leading-[1.7]",
                  state === "done" && "font-semibold text-[#2f7a52]",
                  state === "current" && "font-bold text-[#b45309]",
                  state === "later" && "font-medium text-[#6b7280]")}>
                {state === "done" ? words.done : state === "current" ? words.current : words.later}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-[#1d2025]">
        {allDone
          ? <><Check className="h-4 w-4 text-[#2f7a52]" aria-hidden="true" />{W.allDone}</>
          : W.now(stepWords(at, W).current)}
      </p>
    </section>
  );
}
