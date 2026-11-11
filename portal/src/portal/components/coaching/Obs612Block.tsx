import { cn } from "@/lib/utils";
import { LIST_CARD } from "../../teacher/ui/styles";
import type { Obs612Summary } from "../../lib/obs612";

/**
 * bd-pni007 — an FDE (obs612) visit's result where a FICO page would show its score: the tool, FDE's own result line,
 * one row per section or indicator (a bar only where FDE's tool has a score to draw), what the coach wrote, the footer
 * and, in very small type, the label 'FDE v1'. Every word is the API's data (FDE's tool is in English, as FDE printed
 * it); the coach's own text keeps its own direction. No FICO number, bar or trend is ever drawn beside it.
 */
export function Obs612Block({ o, className }: { o: Obs612Summary; className?: string }) {
  return (
    <section data-testid="obs612" dir="ltr" className={cn(LIST_CARD, "flex flex-col gap-3 p-4", className)}>
      <div className="flex flex-col gap-0.5">
        <span data-testid="obs612-tool" className="text-[13px] font-semibold text-[#6b7280]">{o.toolName}</span>
        <b data-testid="obs612-headline" className="text-[20px] font-bold leading-[1.3] tabular-nums">{o.headline}</b>
      </div>

      {o.rows.length > 0 && (
        <div data-testid="obs612-rows" className="flex flex-col">
          {o.rows.map((r, i) => (
            <div key={`${r.name}-${i}`} data-testid="obs612-row" title={r.full || undefined}
              className={cn("flex flex-col gap-1 py-2 text-[14px] leading-[1.35]", i ? "border-t border-[#f0f1f3]" : "")}>
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1">{r.name}</span>
                <b className="shrink-0 tabular-nums">{r.value}</b>
              </span>
              {typeof r.pct === "number" && Number.isFinite(r.pct) ? (
                <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded bg-[#e8ece9]">
                  <span className="block h-full rounded bg-[#47BA7D]" style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {o.feedback.length > 0 && (
        <div data-testid="obs612-feedback" className="flex flex-col gap-2">
          {o.feedback.map((f, i) => (
            <div key={`${f.label}-${i}`} className="flex flex-col gap-0.5">
              <small className="text-[12.5px] font-bold text-[#6b7280]">{f.label}</small>
              <p dir="auto" className="m-0 whitespace-pre-line text-[15px] leading-[1.5]">{f.text}</p>
            </div>
          ))}
        </div>
      )}

      <p data-testid="obs612-footer" className="m-0 text-[12px] leading-[1.4] text-[#6b7280]">{o.footer}</p>
      <span data-testid="obs612-label" className="text-[10px] leading-none text-[#9ca3af]">{o.label}</span>
    </section>
  );
}

export default Obs612Block;
