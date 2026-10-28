import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { useLoad } from "../useLoad";
import { coachip } from "../api";
import { insightsPaths } from "../paths";
import { InsightsPage, MetaLine, Eyebrow } from "../components/Frame";
import { StateBlock, NoteCard } from "../components/StateBlock";
import { StatsRow } from "../components/StatsRow";
import { Sparkline } from "../components/Sparkline";
import { CountSpan, DateText, WindowMark } from "../count";
import { range } from "../format";
import { pick, t, tx } from "../text";
import type { Stats as StatsData } from "../types";
import { Section } from "../../../coachip-ui/Section";

/**
 * bd-sex15q.15 — S6, Stats (`/stats`, R14): this window per W, against the last window only when the server says the
 * two are comparable. The opening follows `opening.state`:
 *
 *   first_window  the "scoring changed … first month-on-month line after …" card above the rows
 *   marker        a full-width marker row between the column heads and the rows; no pill anywhere
 *   two_windows   both column heads, each window marked (the last window's range small under its head)
 *
 * Then coverage, the AI coach report's panel on its own (fico) window, recordings per week as a sparkline, and the
 * way to Results. Rows, panel rows and weeks keep the payload's order.
 *
 * R6 (bd-sex15q.46, SCREENS.md S6): a top-level tab, so the band, with this window's line as its one line; the rows are
 * one hairline section under a sticky 12 px label row; the FICO panel and the weekly line are sections; Results is a
 * hairline row. Colour only through the coachip-ui tokens.
 */
/** The read sits INSIDE the gate, so with portal_coachip off no /coachip/* request fires (B7; red-2 18:08Z). */
export default function Stats() {
  return (
    <InsightsGate>
      <StatsLoaded />
    </InsightsGate>
  );
}

const HEAD = "cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] text-cp-ink-3";

function StatsLoaded() {
  const lang = useLang();
  const { data, error } = useLoad<StatsData>(() => coachip.stats(), []);
  const sep = lang === "ur" ? "، " : " · ";

  if (!data) {
    return (
      <InsightsPage testId="insights-stats" title={t("s6.title", lang)} windows={[]}>
        <StateBlock error={error} />
      </InsightsPage>
    );
  }

  const { now, before } = data.window_pair;
  const state = data.opening.state;
  const changedOn = data.opening.scoring_changed_on ?? now.from;
  const ficoWin = data.fico_panel.length
    ? data.windows.find((w) => w.id === data.fico_panel[0].lowest_share.window_id) ?? null
    : null;
  const weeks = data.recordings_by_week;
  const latest = weeks.length ? weeks[weeks.length - 1] : null;
  const latestWin = latest ? data.windows.find((w) => w.id === latest.graded.window_id) ?? null : null;
  const results = t("s6.results_link", lang);

  return (
    <InsightsPage
      testId="insights-stats"
      title={t("s6.title", lang)}
      windows={data.windows}
      chips={<MetaLine window={now} className="text-[14px] leading-snug" />}
    >
      {state === "first_window" && (
        <NoteCard tone="info" testId="s6-opening">
          <Eyebrow k="eyebrow.notice" />
          <p className="pt-1">
            {tx("s6.opening.first", lang, {
              date_short: <DateText iso={changedOn} lang={lang} short />,
              date2: <DateText iso={data.opening.first_trend_after} lang={lang} short />,
            })}
          </p>
        </NoteCard>
      )}

      <Section testId="s6-rows" first={state !== "first_window"}>
        <div className="sticky top-0 z-10 flex items-end justify-end gap-4 border-b border-cp-hairline bg-cp-ground pb-2 pt-2 text-end">
          <span data-testid="s6-col-now" className={`w-[96px] ${HEAD}`}>{t("s6.col.now", lang)}</span>
          {before && (
            <span data-testid="s6-col-before" className="flex w-[96px] flex-col">
              <span className={HEAD}>{t("s6.col.before", lang)}</span>
              <WindowMark window={before} as="span" className="text-[12px] font-medium leading-tight text-cp-ink-3">
                {range(before.from, before.to, lang)}
              </WindowMark>
            </span>
          )}
        </div>
        {state === "marker" && (
          <p data-testid="s6-marker" role="note" className="mt-2 rounded-[12px] bg-cp-navy-tint px-4 py-2.5 text-[13px] leading-[1.45] text-cp-navy">
            {tx("s6.marker", lang, { date_short: <DateText iso={changedOn} lang={lang} short /> })}
          </p>
        )}
        <ul>
          {data.rows.map((r) => <StatsRow key={r.w_id} row={r} />)}
        </ul>
      </Section>

      <Section testId="s6-coverage">
        <CountSpan count={data.coverage} as="p" className="text-[15px] leading-[1.45] text-cp-ink-2">
          {t("s6.coverage", lang, { n: data.coverage.n, d: data.coverage.d })}
        </CountSpan>
      </Section>

      {data.fico_panel.length > 0 && (
        <Section testId="s6-fico">
          <h2 className="text-[15px] font-semibold leading-[1.45] text-cp-ink">{t("s6.fico.title", lang)}</h2>
          {ficoWin && <MetaLine window={ficoWin} className="mt-1 text-[13px] leading-[1.45] text-cp-ink-3" />}
          <ul className="mt-2">
            {data.fico_panel.map((f) => (
              <li key={f.indicator} data-indicator={f.indicator}
                className="flex min-h-[44px] items-center border-t border-cp-hairline py-2.5 text-[15px] leading-[1.45] text-cp-ink-2 first:border-t-0">
                <span>{tx("s6.fico.row", lang, { name: pick(f.label, lang) }, [{ n: "n", d: "d", count: f.lowest_share }])}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {weeks.length > 0 && (
        <Section testId="s6-weekly" label={t("s6.weekly.title", lang)}>
          <Sparkline values={weeks.map((w) => w.graded.d)} />
          {latest && (
            <p className="mt-2 text-[13px] leading-[1.45] text-cp-ink-3">
              <CountSpan count={latest.graded}>{t("s6.weekly.sub", lang, { n: latest.graded.d, g: latest.graded.n })}</CountSpan>
              {latestWin && <>{sep}<WindowMark window={latestWin} as="span">{range(latestWin.from, latestWin.to, lang)}</WindowMark></>}
            </p>
          )}
        </Section>
      )}

      <Link
        to={insightsPaths.results}
        data-testid="s6-results-link"
        className="mt-5 flex min-h-[44px] items-center gap-3 border-y border-cp-hairline py-3.5 text-[17px] font-semibold leading-[1.4] text-cp-green-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green"
      >
        <span className="min-w-0 flex-1">{results}</span>
        {/* COPY's English label already ends in "›"; the chevron is drawn only where the words carry none */}
        {!results.trim().endsWith("›") && (
          <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />
        )}
      </Link>
    </InsightsPage>
  );
}
