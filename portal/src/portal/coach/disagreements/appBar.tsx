import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLanguageSwitch } from "../../teacher/useLanguageSwitch";
import { useCopy } from "../../teacher/i18n";
import { FOCUS } from "../../teacher/ui/styles";
import { DISAGREE } from "./copy";

/**
 * bd-tbprit.7 — Rifat's navy app bar over the disagreement screens (prototype .appbar): ← back when there is
 * somewhere to go (the list has none; it opens with her N mark and a line under the name), the screen's name,
 * and the EN | اردو pill. The pill switches through the one writer
 * (useLanguageSwitch → PUT /me/language); the page changes only once the server has it. Tapping the language she is
 * already on writes nothing.
 */
const PILL = "min-h-[30px] rounded-full px-3 text-[13px] font-bold";

export function AppBar({ title, sub, mark, backTo }: { title: ReactNode; sub?: ReactNode; mark?: string; backTo?: string }) {
  const C = useCopy(DISAGREE);
  const { target, status, toggle } = useLanguageSwitch();
  const current = target === "ur" ? "en" : "ur";
  const pill = (lang: "en" | "ur", label: string) => (
    <button
      type="button"
      aria-pressed={current === lang}
      onClick={() => { if (current !== lang) void toggle(); }}
      className={cn(PILL, FOCUS, current === lang ? "bg-white text-[#2f3446]" : "bg-transparent text-white")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex min-h-[56px] items-center gap-3 bg-[#2f3446] px-4 py-2 text-white" data-testid="disagreements-appbar">
      {backTo && (
        <Link to={backTo} data-testid="appbar-back" aria-label={C.back} className={cn(FOCUS, "text-[20px] font-bold leading-none")}>
          <span aria-hidden="true">{current === "ur" ? "→" : "←"}</span>
        </Link>
      )}
      {mark && (
        <span data-testid="appbar-mark" aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2f9a46] text-[16px] font-extrabold">
          {mark}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[16px] font-extrabold">{title}</span>
        {sub && <span className="truncate text-[12px] text-white/75">{sub}</span>}
      </span>
      {status === "failed" && <span className="text-[12px] text-white/80">{C.notSaved}</span>}
      <span className="flex gap-0.5 rounded-full border border-white/40 p-0.5" dir="ltr">
        {pill("en", "EN")}
        {pill("ur", "اردو")}
      </span>
    </div>
  );
}
