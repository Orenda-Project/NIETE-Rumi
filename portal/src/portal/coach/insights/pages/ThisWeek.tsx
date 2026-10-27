import { Link } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { coachip } from "../api";
import { CountSpan, DateText } from "../count";
import { todayKarachi } from "../format";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import { useLoad } from "../useLoad";
import type { Home, WCard as WCardData, WRow as WRowData } from "../types";
import { InsightsPage, MetaLine } from "../components/Frame";
import { NoteCard, StateBlock } from "../components/StateBlock";
import { NoteBanner } from "../components/NoteBanner";
import { NotYetTile } from "../components/NotYetTile";
import { PhonicsTile } from "../components/PhonicsTile";
import { StepRow } from "../components/StepRow";
import { WCard } from "../components/WCard";
import { WRow } from "../components/WRow";

/**
 * bd-sex15q.15 — S1 "This week", the coach's home (DESIGN §3 S1, COPY §S1, API R2 `GET /coachip/home`). Top to bottom:
 * the stale banner, the RM's note, at most two moves (the card, then Move 2 as G9's row), the coverage line, the open
 * steps, the Not-yet tile, the phonics tile, the link to stats. Every word is COPY or the server's Text; every number
 * goes through count.tsx; codes and school names only.
 *
 * The read sits INSIDE the gate, so with portal_coachip off no request to /coachip/home fires (B7). The band's second
 * line is band.sub, the date only (COPY v1.1 §8): /me's counts are never rendered as numbers (API R1).
 *
 * Empty states (API R2): no_scope shows its message alone; pending its message, the phonics tile and the stats link;
 * insufficient and failed keep the open steps. Never a zero, never an average.
 */
export default function ThisWeek() {
  return (
    <InsightsGate>
      <ThisWeekLoaded />
    </InsightsGate>
  );
}

function ThisWeekLoaded() {
  const lang = useLang();
  const { data, error } = useLoad<Home>(() => coachip.home(), []);
  return (
    <InsightsPage
      testId="insights-this-week"
      title={t("band.title", lang)}
      // today's date is the band's second line (a top-level page has no crumb): band.sub, the date only (COPY v1.1 §8)
      chips={<span data-testid="s1-today">{tx("band.sub", lang, { date_short: <DateText iso={todayKarachi()} lang={lang} short /> })}</span>}
      windows={data?.windows}
    >
      {!data ? <StateBlock error={error} /> : <Body home={data} />}
    </InsightsPage>
  );
}

function EmptyMessage({ home }: { home: Home }) {
  const lang = useLang();
  const empty = home.empty;
  if (!empty) return null;
  let line: React.ReactNode;
  if (empty.status === "no_scope") line = t("s1.empty.no_scope", lang);
  else if (empty.status === "pending") line = t("s1.empty.pending", lang);
  // the policy's "7 days" is a fixed rule, not a count
  else if (empty.status === "failed") line = <span data-nonum="">{t("s1.empty.failed", lang)}</span>;
  else {
    const g = empty.detail.graded;
    if (!g) line = <span data-text="server">{pick(empty.message, lang)}</span>;
    else if (empty.detail.widened_to_weeks === 8) {
      line = <CountSpan count={g}>{t("s1.empty.insufficient8", lang, { graded: g.n, needed: g.d })}</CountSpan>;
    } else {
      line = <CountSpan count={g}>{t("s1.empty.insufficient4", lang, { graded: g.n, needed: g.d })}</CountSpan>;
    }
  }
  // with no card on screen, the window the page's counts refer to is said here
  const showWindow = home.moves.length === 0 && (empty.status === "insufficient" || empty.status === "failed");
  return (
    <div data-testid="s1-empty" data-status={empty.status}>
      <NoteCard>
        <p>{line}</p>
        {showWindow && <MetaLine window={home.window} className="mt-1.5 text-[12.5px] leading-snug text-[#6b7280]" />}
      </NoteCard>
    </div>
  );
}

function Body({ home }: { home: Home }) {
  const lang = useLang();
  const status = home.empty?.status ?? null;
  const quiet = status === "no_scope" || status === "pending";
  const card = home.moves[0] as WCardData | undefined;
  const second = home.moves[1] as WRowData | undefined;
  const cov = home.coverage.recordings;
  return (
    <div className="flex flex-col gap-3 pb-2">
      {home.stale && (
        <div data-testid="s1-stale">
          <NoteCard>{tx("s1.stale", lang, { date: <DateText iso={home.stale.as_of} lang={lang} /> })}</NoteCard>
        </div>
      )}
      {home.note && status !== "no_scope" && <NoteBanner note={home.note} />}
      <EmptyMessage home={home} />

      {card && <WCard card={card} total={home.moves.length} />}
      {second && <WRow row={second} to={insightsPaths.w(second.w_id)} />}

      {!quiet && cov.d > 0 && (
        <CountSpan as="p" count={cov} className="px-1 text-[13.5px] leading-snug text-[#6b7280]">
          {t("s1.coverage", lang, { n: cov.n, d: cov.d })}
        </CountSpan>
      )}

      {!quiet && (
        <section data-testid="s1-steps" className="flex flex-col rounded-2xl border border-[#e5e7eb] bg-white px-4 pt-3.5 pb-2">
          <h2 className="text-[17px] font-semibold text-[#1d2025]">{t("s1.steps.title", lang)}</h2>
          <p className="text-[13.5px] leading-snug text-[#6b7280]">{t("s1.steps.sub", lang)}</p>
          {home.steps.length ? (
            <>
              <ul className="flex flex-col">
                {home.steps.map((s) => <StepRow key={s.id} step={s} windowId={home.window.id} />)}
              </ul>
              <p data-testid="s1-steps-legend" className="pb-1.5 text-[12.5px] text-[#6b7280]">{t("s1.steps.legend", lang)}</p>
            </>
          ) : (
            <p data-testid="s1-steps-empty" className="py-2 text-[14.5px] text-[#374151]">{t("s1.steps.empty", lang)}</p>
          )}
        </section>
      )}

      {!quiet && <NotYetTile rows={home.not_yet} />}

      {status !== "no_scope" && <PhonicsTile phonics={home.phonics} />}

      {status !== "no_scope" && (
        <Link data-testid="s1-stats-link" to={insightsPaths.stats}
          className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-[#d1d5db] bg-white px-4 text-[16px] font-semibold text-[#1d2025]">
          {t("s1.stats_link", lang)}
        </Link>
      )}
    </div>
  );
}
