import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useLang } from "../../teacher/i18n";
import { WindowsProvider } from "../../coach/insights/count";
import type { Window } from "../../coach/insights/types";
import RmNav from "../RmNav";
import { rt, type AnyKey } from "../text";

/**
 * bd-sex15q.17 — the frame of every RM page (inside RmGate): the RM menu, the NIETE slate band with the page's name, a
 * laptop-wide container (S8 is read at 1440×900 first, then on a phone), the payload's windows for the count contract,
 * and the trust line at the foot. Bottom padding clears the phone menu.
 */
export function RmPage({ title, sub, backTo, windows, testId, trust, children }: {
  title: ReactNode; sub?: ReactNode; backTo?: string; windows?: readonly Window[] | null; testId: string; trust?: AnyKey | null; children: ReactNode;
}) {
  const lang = useLang();
  return (
    <div className="-mx-4 -mt-4 md:-mx-6 lg:-mx-8">
      <RmNav />
      <div data-testid={testId} dir={lang === "ur" ? "rtl" : "ltr"} className="mx-auto w-full max-w-7xl px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 text-[#1d2025] md:px-6 md:pb-10">
        <header data-testid="rm-band" className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-center gap-2">
            {backTo && (
              <Link to={backTo} aria-label={rt("s9.back", lang)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-white">
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </Link>
            )}
            <h1 className="text-[24px] font-semibold leading-tight md:text-[28px]">{title}</h1>
          </div>
          {sub && <p className="text-[14px] text-[#6b7280]">{sub}</p>}
        </header>
        <WindowsProvider windows={windows}>
          {children}
          {trust && <p data-testid="rm-trust" className="px-1 pt-4 text-center text-[12.5px] text-[#6b7280]">{rt(trust, lang)}</p>}
        </WindowsProvider>
      </div>
    </div>
  );
}

/** A white card, the kit's radius and border. */
export function RmCard({ children, testId, className, title, sub }: { children: ReactNode; testId?: string; className?: string; title?: ReactNode; sub?: ReactNode }) {
  return (
    <section data-testid={testId} className={`flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] md:px-5 ${className ?? ""}`}>
      {title && <h2 className="text-[17px] font-semibold leading-snug text-[#1d2025]">{title}</h2>}
      {sub && <p className="text-[13.5px] leading-snug text-[#6b7280]">{sub}</p>}
      {children}
    </section>
  );
}

/** A plain status card (no sector, stale, an Empty): words only, numbers already marked by the caller. */
export function RmNote({ children, testId, tone = "neutral" }: { children: ReactNode; testId?: string; tone?: "neutral" | "info" }) {
  return (
    <div role="status" data-testid={testId} className={tone === "info"
      ? "rounded-2xl bg-[#eef2ff] px-4 py-3.5 text-[15px] leading-snug text-[#312e81]"
      : "rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 text-[15px] leading-snug text-[#374151]"}>
      {children}
    </div>
  );
}
