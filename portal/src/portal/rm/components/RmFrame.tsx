import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useLang } from "../../teacher/i18n";
import { WindowsProvider } from "../../coach/insights/count";
import { NoteCard } from "../../coach/insights/components/StateBlock";
import type { Window } from "../../coach/insights/types";
import { Shell } from "../../coachip-ui/Shell";
import { Band } from "../../coachip-ui/Band";
import { AppBar } from "../../coachip-ui/AppBar";
import { LangToggle } from "../../coachip-ui/LangToggle";
import { Surface } from "../../coachip-ui/Surface";
import RmNav from "../RmNav";
import { currentRmItem } from "../paths";
import { rt, type AnyKey } from "../text";

/**
 * bd-sex15q.17, restyled bd-sex15q.42 (R6) — the frame of every RM page (inside RmGate): the COACHIP Shell with the RM
 * menu (the phone's bottom bar, the laptop's rail), the header, the payload's windows for the count contract, and the
 * trust line at the foot.
 *
 *   the sector home (S8)  the band: NIETE lockup, the title, `sub` as its line, `hero` as its body (the ring), and the
 *                         phone's EN | اردو at its top end
 *   every other page      the slim app bar (`backTo` → the back circle), `sub` as its window line, the same EN | اردو
 *
 * `band` forces either; by default the Sector tab is the home. Both headers carry `rm-band`, the line `rm-page-sub`.
 * On a laptop S8 takes the full width (`wide`, the three-column grid); the others the 720 px column.
 */
export function RmPage({ title, sub, backTo, windows, testId, trust, band, hero, wide, aside, children }: {
  title: ReactNode; sub?: ReactNode; backTo?: string; windows?: readonly Window[] | null; testId: string; trust?: AnyKey | null;
  band?: boolean; hero?: ReactNode; wide?: boolean; aside?: ReactNode; children: ReactNode;
}) {
  const lang = useLang();
  const { pathname } = useLocation();
  const home = band ?? (!backTo && currentRmItem(pathname) === "sector");
  const line = sub ? <span data-testid="rm-page-sub">{sub}</span> : undefined;
  const header = home
    ? <Band testId="rm-band" title={title} sub={line} trailing={<span className="lg:hidden"><LangToggle prefix="rm-lang" tone="dark" /></span>}>{hero}</Band>
    : <AppBar testId="rm-band" backTo={backTo} backLabel={backTo ? rt("s9.back", lang) : undefined} title={title} sub={line}
        trailing={<span className="lg:hidden"><LangToggle prefix="rm-lang" /></span>} />;
  return (
    <WindowsProvider windows={windows}>
      <Shell testId={testId} dir={lang === "ur" ? "rtl" : "ltr"} bleed nav={<RmNav />} header={header} wide={wide ?? home} aside={aside}
        trust={trust ? <p data-testid="rm-trust" className="px-1 pt-6 text-[13px] leading-[1.45] text-cp-ink-3">{rt(trust, lang)}</p> : null}>
        {children}
      </Shell>
    </WindowsProvider>
  );
}

/**
 * A block on an RM page (CODE_MAP C3: one look with the coach's Card): flat under a hairline with an optional 20/700
 * title and a hint, or the screen's one raised card (`elevated` → coachip-ui Surface).
 */
export function RmCard({ children, testId, className, title, sub, elevated = false }: {
  children: ReactNode; testId?: string; className?: string; title?: ReactNode; sub?: ReactNode; elevated?: boolean;
}) {
  const head = (
    <>
      {title && <h2 className="text-[20px] font-bold leading-[1.3] text-cp-navy">{title}</h2>}
      {sub && <p className="text-[13px] leading-[1.45] text-cp-ink-3">{sub}</p>}
    </>
  );
  if (elevated) return <Surface testId={testId} className={className}>{head}{children}</Surface>;
  return (
    <section data-testid={testId} className={`flex flex-col gap-2 border-t border-cp-hairline py-5 first:border-t-0 first:pt-1 ${className ?? ""}`}>
      {head}
      {children}
    </section>
  );
}

/** A plain status note (no sector, stale, an Empty): the coach's NoteCard (C3), one look for both decks. */
export const RmNote = NoteCard;
