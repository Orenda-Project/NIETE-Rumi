import type { ReactNode } from "react";
import TeacherPage from "../../../teacher/TeacherPage";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { WindowMark, WindowsProvider } from "../count";
import { dateShort, range } from "../format";
import { pick, t } from "../text";
import type { Window } from "../types";

/**
 * bd-sex15q.15 — the frame of every coach insight page: the gate (v2 coach + portal_coachip), the kit page (TeacherPage:
 * grey page, one phone column, the bottom menu from PortalLayout), the payload's windows for the count contract, and the
 * trust line at the foot.
 */
export function InsightsPage({ title, crumb, chips, backTo, windows, testId, hero, children, trust = true }: {
  title?: ReactNode; crumb?: ReactNode; chips?: ReactNode; backTo?: string; windows?: readonly Window[] | null; testId: string; hero?: ReactNode;
  children: ReactNode; trust?: boolean;
}) {
  return (
    <InsightsGate>
      <TeacherPage
        title={title}
        crumb={crumb}
        chips={backTo ? chips : undefined}
        backTo={backTo}
        testId={testId}
        hero={hero ?? (backTo ? undefined : <Band title={title} sub={chips} />)}
      >
        <WindowsProvider windows={windows}>
          {children}
          {trust && <TrustLine />}
        </WindowsProvider>
      </TeacherPage>
    </InsightsGate>
  );
}

/**
 * A top-level page's slim band (This week, Schools, Listen, Stats): the NIETE slate, the page's name and one line under
 * it, about 72 px tall instead of the kit's 32 px title block (~120 px), so S1's first move sits above the fold (the
 * studio's A v2 band, CONVERGENCE §1).
 */
export function Band({ title, sub }: { title?: ReactNode; sub?: ReactNode }) {
  return (
    <div data-testid="insights-band" className="flex min-h-[72px] flex-col justify-center bg-[#333748] px-5 py-3 text-white min-[576px]:px-6">
      <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
      {sub && <p className="text-[14px] text-[#d1d5db]">{sub}</p>}
    </div>
  );
}

export function TrustLine() {
  const lang = useLang();
  return <p data-testid="trust-line" className="px-1 pt-2 text-center text-[12.5px] text-[#6b7280]">{t("trust.coach", lang)}</p>;
}

/**
 * The meta line every card with a number carries (COPY §W): "{range} · {grader_label}", plus "scoring changed {date}".
 * It is the element the card's `data-win` resolves to.
 */
export function MetaLine({ window, className, showChange = true }: { window: Window; className?: string; showChange?: boolean }) {
  const lang = useLang();
  const parts = [range(window.from, window.to, lang)];
  if (window.grader_label) parts.push(pick(window.grader_label, lang));
  if (showChange && window.scoring_changed_on) parts.push(t("meta.changed", lang, { date_short: dateShort(window.scoring_changed_on, lang) }));
  return (
    <WindowMark window={window} className={className ?? "text-[12.5px] leading-snug text-[#6b7280]"}>
      {parts.join(lang === "ur" ? "، " : " · ")}
    </WindowMark>
  );
}

/** The cycle word above a card: NOTICE · LISTEN · ONE MOVE · CHECK. */
export function Eyebrow({ k, children }: { k: "eyebrow.notice" | "eyebrow.listen" | "eyebrow.one_move" | "eyebrow.check"; children?: ReactNode }) {
  const lang = useLang();
  return (
    <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-[#47BA7D] rtl:tracking-normal">
      {t(k, lang)}{children ? <span className="text-[#6b7280]">{lang === "ur" ? "، " : " · "}{children}</span> : null}
    </p>
  );
}

/** A white card, the kit's radius and border. */
export function Card({ children, testId, className }: { children: ReactNode; testId?: string; className?: string }) {
  return (
    <section data-testid={testId} className={`flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${className ?? ""}`}>
      {children}
    </section>
  );
}
