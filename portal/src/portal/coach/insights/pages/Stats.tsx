import { Link } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { useLoad } from "../useLoad";
import { coachip } from "../api";
import { insightsPaths } from "../paths";
import { InsightsPage, MetaLine, Eyebrow, Card } from "../components/Frame";
import { StateBlock, NoteCard } from "../components/StateBlock";
import { StatsRow } from "../components/StatsRow";
import { Sparkline } from "../components/Sparkline";
import { CountSpan, DateText, WindowMark } from "../count";
import { range } from "../format";
import { pick, t, tx } from "../text";
import type { Stats as StatsData } from "../types";

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
 */
/** The read sits INSIDE the gate, so with portal_coachip off no /coachip/* request fires (B7; red-2 18:08Z). */
export default function Stats() {
  return (
    <InsightsGate>
      <StatsLoaded />
    </InsightsGate>
  );
}

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

  return (
    <InsightsPage testId="insights-stats" title={t("s6.title", lang)} windows={data.windows}>
      <MetaLine window={now} className="px-1 text-[12.5px] leading-snug text-[#6b7280]" />

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

      <section data-testid="s6-rows" className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
        <div className="flex items-end justify-end gap-3 px-4 pb-1 pt-3 text-end text-[11.5px] font-semibold text-[#6b7280]">
          <span data-testid="s6-col-now" className="w-[96px]">{t("s6.col.now", lang)}</span>
          {before && (
            <span data-testid="s6-col-before" className="flex w-[96px] flex-col">
              <span>{t("s6.col.before", lang)}</span>
              <WindowMark window={before} as="span" className="text-[10.5px] font-normal leading-tight">
                {range(before.from, before.to, lang)}
              </WindowMark>
            </span>
          )}
        </div>
        {state === "marker" && (
          <p data-testid="s6-marker" role="note" className="border-y border-dashed border-[#c7d2fe] bg-[#eef2ff] px-4 py-2 text-[13px] leading-snug text-[#312e81]">
            {tx("s6.marker", lang, { date_short: <DateText iso={changedOn} lang={lang} short /> })}
          </p>
        )}
        <ul>
          {data.rows.map((r) => <StatsRow key={r.w_id} row={r} />)}
        </ul>
      </section>

      <Card testId="s6-coverage">
        <CountSpan count={data.coverage} as="p" className="text-[14.5px] leading-snug text-[#374151]">
          {t("s6.coverage", lang, { n: data.coverage.n, d: data.coverage.d })}
        </CountSpan>
      </Card>

      {data.fico_panel.length > 0 && (
        <Card testId="s6-fico">
          <h2 className="text-[14.5px] font-semibold leading-snug text-[#1d2025]">{t("s6.fico.title", lang)}</h2>
          {ficoWin && <MetaLine window={ficoWin} />}
          <ul className="flex flex-col gap-1.5">
            {data.fico_panel.map((f) => (
              <li key={f.indicator} data-indicator={f.indicator} className="text-[14px] leading-snug text-[#374151]">
                {tx("s6.fico.row", lang, { name: pick(f.label, lang) }, [{ n: "n", d: "d", count: f.lowest_share }])}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {weeks.length > 0 && (
        <Card testId="s6-weekly">
          <h2 className="text-[14.5px] font-semibold leading-snug text-[#1d2025]">{t("s6.weekly.title", lang)}</h2>
          <Sparkline values={weeks.map((w) => w.graded.d)} />
          {latest && (
            <p className="text-[12.5px] leading-snug text-[#6b7280]">
              <CountSpan count={latest.graded}>{t("s6.weekly.sub", lang, { n: latest.graded.d, g: latest.graded.n })}</CountSpan>
              {latestWin && <>{sep}<WindowMark window={latestWin} as="span">{range(latestWin.from, latestWin.to, lang)}</WindowMark></>}
            </p>
          )}
        </Card>
      )}

      <Link
        to={insightsPaths.results}
        data-testid="s6-results-link"
        className="flex min-h-[44px] items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3 text-[15.5px] font-semibold text-[#1d2025]"
      >
        {t("s6.results_link", lang)}
      </Link>
    </InsightsPage>
  );
}
