import type { ReactNode } from "react";
import PortalLayout from "../../../components/PortalLayout";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { WindowMark, WindowsProvider } from "../count";
import { dateShort, range } from "../format";
import { pick, t } from "../text";
import type { Window } from "../types";
import { Shell } from "../../../coachip-ui/Shell";
import { Band as CpBand, Eyebrow as CpEyebrow } from "../../../coachip-ui/Band";
import { AppBar } from "../../../coachip-ui/AppBar";

/**
 * bd-sex15q.15, restyled bd-sex15q.42 (R6) — the frame of every coach insight page: the gate (v2 coach +
 * portal_coachip), the portal's layout (session, the coach menu: PortalNavigation → InsightsNav), the COACHIP Shell
 * (the `.cp` tokens, the 720 + 320 laptop columns), the payload's windows for the count contract, and the trust line
 * at the foot (in the rail on a laptop).
 *
 *   top-level page  the band (`Band`): NIETE lockup, the title, `chips` as its line; `hero` replaces it entirely
 *   inner page      the slim app bar (`backTo`): back circle, `crumb` as its eyebrow, the title, `chips` as its line
 *   `aside`         the laptop's right column (the moment, open steps); on a phone it follows the page
 *
 * R6 fix cycle 1 (FIX_R6 A6, panel 230201): on a home the trust line is the band's foot on a phone and the rail's on a
 * laptop, so the page foot does not repeat it; an inner page keeps it at the foot. A line still coming is `null`
 * (AppBar/Band draw its placeholder, A1); `undefined` means the page has no such line. `screenWindow` is the id of the
 * window `chips` (or the band's pill) states, so a row in that window says no range of its own (A4).
 */
export function InsightsPage({ title, crumb, chips, backTo, windows, testId, hero, aside, wide, children, trust = true, screenWindow = null }: {
  title?: ReactNode; crumb?: ReactNode; chips?: ReactNode; backTo?: string; windows?: readonly Window[] | null; testId: string; hero?: ReactNode;
  aside?: ReactNode; wide?: boolean; children: ReactNode; trust?: boolean; screenWindow?: string | null;
}) {
  const header = hero ?? (backTo
    ? <AppBar testId="insights-appbar" backTo={backTo} eyebrow={crumb} title={title} sub={chips} />
    : <Band title={title} sub={chips} />);
  const home = Boolean(hero) || !backTo;
  return (
    <InsightsGate>
      <PortalLayout ownHeading>
        <WindowsProvider windows={windows}>
          <Shell testId={testId} header={header} aside={aside} wide={wide} padBottom="layout" fullHeight={false} screenWindow={screenWindow}
            trust={trust && !home ? <TrustLine /> : null} trustInRail>
            {children}
          </Shell>
        </WindowsProvider>
      </PortalLayout>
    </InsightsGate>
  );
}

/**
 * A top-level page's band (This week, Schools, Listen, Stats): coachip-ui's Band (navy slate, lattice, lockup) with the
 * page's name and one line under it; `children` is its body (S1's ring and sentence), which becomes the hero card on
 * a laptop.
 */
export function Band({ title, sub, date, fixed, children }: { title?: ReactNode; sub?: ReactNode; date?: ReactNode; fixed?: boolean; children?: ReactNode }) {
  const lang = useLang();
  return <CpBand testId="insights-band" title={title} sub={sub} date={date} fixed={fixed} foot={t("trust.coach", lang)}>{children}</CpBand>;
}

export function TrustLine() {
  const lang = useLang();
  return <p data-testid="trust-line" className="px-1 pt-6 text-[13px] leading-[1.45] text-cp-ink-3">{t("trust.coach", lang)}</p>;
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
    <WindowMark window={window} className={className ?? "cp-meta"}>
      {parts.join(lang === "ur" ? "، " : " · ")}
    </WindowMark>
  );
}

/** The cycle word above a card: NOTICE · LISTEN · ONE MOVE · CHECK (green-ink on white, green on the band). */
export function Eyebrow({ k, children }: { k: "eyebrow.notice" | "eyebrow.listen" | "eyebrow.one_move" | "eyebrow.check"; children?: ReactNode }) {
  const lang = useLang();
  return (
    <CpEyebrow>
      {t(k, lang)}{children ? <span className="text-cp-ink-3">{lang === "ur" ? "، " : " · "}{children}</span> : null}
    </CpEyebrow>
  );
}

/**
 * A block on the page. R6: flat on the ground under a hairline (A's page), not a boxed card; the screen's ONE raised
 * card is coachip-ui's `Surface` (`elevated`).
 */
export function Card({ children, testId, className, elevated = false }: { children: ReactNode; testId?: string; className?: string; elevated?: boolean }) {
  return (
    <section
      data-testid={testId}
      className={elevated
        ? `flex flex-col gap-2 rounded-[20px] bg-cp-surface p-5 shadow-[0_2px_8px_rgba(51,55,72,0.08)] lg:p-7 ${className ?? ""}`
        : `flex flex-col gap-2 border-t border-cp-hairline py-5 first:border-t-0 first:pt-1 ${className ?? ""}`}
    >
      {children}
    </section>
  );
}
