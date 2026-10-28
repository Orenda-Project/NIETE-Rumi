import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { coachip } from "../api";
import { CountSpan, DateText } from "../count";
import { todayKarachi } from "../format";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import { useLoad } from "../useLoad";
import type { Home, Moment, WCard as WCardData, WRow as WRowData } from "../types";
import api from "../../../services/api";
import MomentSlot from "../MomentSlot";
import { Band, InsightsPage, MetaLine } from "../components/Frame";
import { StateBlock } from "../components/StateBlock";
import { NoteBanner } from "../components/NoteBanner";
import { NotYetTile } from "../components/NotYetTile";
import { PhonicsTile } from "../components/PhonicsTile";
import { StepRow } from "../components/StepRow";
import { WCard, WCardHero } from "../components/WCard";
import { WRow } from "../components/WRow";
import { Ring } from "../../../coachip-ui/Ring";
import { Section } from "../../../coachip-ui/Section";
import { useLaptop } from "../../../coachip-ui/useLaptop";

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
 *
 * R6 (bd-sex15q.46, design/r6 merged_S1_390 / merged_S1_1440): the band carries the headline (WCardHero: eyebrow, the
 * ring, the sentence, the window pill) or, with no move, the empty sentence beside an empty ring; the stale line sits
 * in the band under it. The overlapping card (WCard) is the first thing under the band; then the RM's note, Move 2 as a
 * row, the coverage line, open steps, Not yet and phonics as hairline sections, the stats link. On a laptop the open
 * steps move to the right column under the moment's player, and where-first with the actions sits inside the hero card.
 * While loading, the band already holds an empty ring so nothing jumps.
 */
export default function ThisWeek() {
  return (
    <InsightsGate>
      <ThisWeekLoaded />
    </InsightsGate>
  );
}

/** Today's date in the band's top line: band.sub, the date only (COPY v1.1 §8). */
function Today() {
  const lang = useLang();
  return <span data-testid="s1-today">{tx("band.sub", lang, { date_short: <DateText iso={todayKarachi()} lang={lang} short /> })}</span>;
}

/** The band's body before the data lands: the empty ring and two quiet lines, the height of the real body. */
function HeroLoading() {
  return (
    <div className="flex items-center gap-4" aria-busy="true">
      <Ring n={0} d={0} size="hero" />
      <span className="flex flex-1 flex-col gap-2.5">
        <span className="cp-skeleton block h-4 w-full rounded-full bg-white/15 lg:bg-cp-hairline" />
        <span className="cp-skeleton block h-4 w-4/5 rounded-full bg-white/15 lg:bg-cp-hairline" />
      </span>
    </div>
  );
}

/** The window pill on the band (also used by the empty body when the page has no move card). */
const BAND_PILL = "self-start rounded-full bg-cp-green px-3 py-[5px] text-[12px] font-semibold leading-[1.45] text-cp-navy";

function Stale({ home }: { home: Home }) {
  const lang = useLang();
  if (!home.stale) return null;
  return (
    <p data-testid="s1-stale" role="status" className="cp-on-band-2 text-[13px] leading-[1.45]">
      {tx("s1.stale", lang, { date: <DateText iso={home.stale.as_of} lang={lang} /> })}
    </p>
  );
}

function Hero({ home, laptop }: { home: Home | null; laptop: boolean }) {
  if (!home) return <HeroLoading />;
  const card = home.moves[0] as WCardData | undefined;
  return (
    <div className="flex flex-col gap-3">
      {card ? <WCardHero card={card} total={home.moves.length} /> : <EmptyMessage home={home} />}
      <Stale home={home} />
      {card && laptop && <WCard card={card} total={home.moves.length} inHero />}
    </div>
  );
}

/**
 * The laptop's right column (merged_S1_1440, ux-lead-2 174713 item 3): the headline's moment in the inline player
 * (S4's read, R6; the clip itself only on a tap, preload none), then the open steps. Never mounted on a phone.
 */
function Aside({ home }: { home: Home }) {
  const lang = useLang();
  const card = home.moves[0] as WCardData | undefined;
  const mid = card?.moment_id ?? null;
  const { data: moment } = useLoad<Moment | null>(
    () => (mid ? api.get(`/coachip/m/${encodeURIComponent(mid)}`).then((r) => r.data as Moment) : Promise.resolve(null)),
    [mid],
  );
  return (
    <div className="flex flex-col">
      {moment && (
        <Section first label={t("s2.moment.title", lang)} testId="s1-moment">
          <MomentSlot moment={moment} />
        </Section>
      )}
      <Steps home={home} first={!moment} />
    </div>
  );
}

function ThisWeekLoaded() {
  const lang = useLang();
  const { data, error } = useLoad<Home>(() => coachip.home(), []);
  const laptop = useLaptop();
  return (
    <InsightsPage
      testId="insights-this-week"
      // on a laptop the band's body is the hero card, and where-first with the two actions sits inside it
      hero={(
        <Band title={t("band.title", lang)} date={<Today />}>
          {error && !data ? null : <Hero home={data} laptop={laptop} />}
        </Band>
      )}
      windows={data?.windows}
      aside={data && laptop && !quietOf(data) ? <Aside home={data} /> : undefined}
    >
      {!data ? <StateBlock error={error} /> : <Body home={data} laptop={laptop} />}
    </InsightsPage>
  );
}

function quietOf(home: Home): boolean {
  const status = home.empty?.status ?? null;
  return status === "no_scope" || status === "pending";
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
  // with no card on screen, the window the page's counts refer to is said here, as the band's pill
  const showWindow = home.moves.length === 0 && (empty.status === "insufficient" || empty.status === "failed");
  return (
    <div data-testid="s1-empty" data-status={empty.status} role="status" className="flex flex-col gap-3">
      <div className={`flex items-center gap-4 ${lang === "ur" ? "flex-row-reverse" : ""}`}>
        <Ring n={0} d={0} size="hero" />
        <p className="min-w-0 flex-1 text-[17px] font-medium leading-[1.42]">{line}</p>
      </div>
      {showWindow && <MetaLine window={home.window} className={BAND_PILL} />}
    </div>
  );
}

/** Open steps: what the coach set, and the next three recordings (a hairline section; the right column on a laptop). */
function Steps({ home, first = false }: { home: Home; first?: boolean }) {
  const lang = useLang();
  return (
    <Section testId="s1-steps" first={first} label={t("s1.steps.title", lang)} hint={t("s1.steps.sub", lang)}>
      {home.steps.length ? (
        <>
          <ul className="flex flex-col">
            {home.steps.map((s) => <StepRow key={s.id} step={s} windowId={home.window.id} />)}
          </ul>
          <p data-testid="s1-steps-legend" className="pt-1 text-[13px] text-cp-ink-3">{t("s1.steps.legend", lang)}</p>
        </>
      ) : (
        <p data-testid="s1-steps-empty" className="py-2 text-[15px] text-cp-ink-2">{t("s1.steps.empty", lang)}</p>
      )}
    </Section>
  );
}

function Body({ home, laptop }: { home: Home; laptop: boolean }) {
  const lang = useLang();
  const status = home.empty?.status ?? null;
  const quiet = quietOf(home);
  const card = home.moves[0] as WCardData | undefined;
  const second = home.moves[1] as WRowData | undefined;
  const cov = home.coverage.recordings;
  return (
    <div className="flex flex-col pb-2">
      {card && !laptop && <WCard card={card} total={home.moves.length} />}
      {home.note && status !== "no_scope" && <div className="mt-4"><NoteBanner note={home.note} /></div>}

      {second && <div className="mt-2"><WRow row={second} to={insightsPaths.w(second.w_id)} /></div>}

      {!quiet && cov.d > 0 && (
        <CountSpan as="p" count={cov} className="px-1 pt-3 text-[13px] leading-[1.45] text-cp-ink-3">
          {t("s1.coverage", lang, { n: cov.n, d: cov.d })}
        </CountSpan>
      )}

      {!quiet && !laptop && <Steps home={home} />}

      {!quiet && <NotYetTile rows={home.not_yet} />}

      {status !== "no_scope" && <PhonicsTile phonics={home.phonics} />}

      {status !== "no_scope" && (
        <div className="mt-5 border-t border-cp-hairline pt-4">
          <Link data-testid="s1-stats-link" to={insightsPaths.stats}
            className="flex min-h-[44px] items-center gap-1.5 text-[17px] font-semibold text-cp-green-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
            {t("s1.stats_link", lang)}
            {/* the English label ends in "›"; the Urdu one has none, so the chevron is drawn for it */}
            {lang === "ur" && <ChevronRight size={20} strokeWidth={1.5} className="rotate-180" aria-hidden="true" />}
          </Link>
        </div>
      )}
    </div>
  );
}
