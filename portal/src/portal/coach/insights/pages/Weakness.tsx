import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { coachip } from "../api";
import { useLoad } from "../useLoad";
import { InsightsPage, MetaLine } from "../components/Frame";
import { NoteCard, StateBlock } from "../components/StateBlock";
import StepCard, { openStepFor } from "../components/StepCard";
import { schoolLine } from "../components/SchoolRow";
import MethodSheet from "../components/MethodSheet";
import MomentSlot from "../MomentSlot";
import { CodeText, CountSpan, DateText, LibraryText, Num, StatSpan } from "../count";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { Home, Moment, WDetail } from "../types";
import { RingCount, RowCount } from "../../../coachip-ui/Count";
import { FractionBar } from "../../../coachip-ui/FractionBar";
import { Section } from "../../../coachip-ui/Section";
import { useLaptop } from "../../../coachip-ui/useLaptop";
import { isolateRuns } from "../components/bidi";

/**
 * bd-sex15q.15 — S2, one move in one fold (G1): `/w/:wId`, read from `GET /coachip/w/:wId`. Top to bottom: NOTICE, the
 * number line and sentence, the meta line (the card's window) and the school to visit first (→ S3); then the moment
 * (`#moment`, S1's Listen link lands here) with the inline player and the step card, both above the 704 px fold at
 * 390×844 (B v2's one-fold order, measured by outputs/lanes/m-ui/measure); below the fold: why (the cause and the split
 * on one denominator), where it shows (three schools, then all), what good looks like, the method sheet collapsed. The app bar says the short name, never "weakness".
 *
 * The read sits inside the gate, so with the switch off nothing is requested (B7).
 *
 * R6 (bd-sex15q.46, DIRECTION delta 5, merged_S2_390): no band. The app bar carries "Move k of m · this month", the short
 * name and the screen's ONE window line; the number is a card-size ring on white with the sentence beside it; the step
 * card is the one raised surface with the one primary, inside the fold; then the moment (player + strip); Why, Where
 * and What good looks like as hairline sections with 4 px fraction bars; the method sheet as a disclosure row.
 */
export default function Weakness() {
  return (
    <InsightsGate>
      <WeaknessBody />
    </InsightsGate>
  );
}

/** COPY s2.insufficient's floor: R3 carries no `needed`; API §3 names the coach floor as 20 graded lessons. */
export const COACH_FLOOR = 20;

function WeaknessBody() {
  const { wId = "" } = useParams();
  const lang = useLang();
  const { data, error } = useLoad<WDetail>(() => coachip.w(wId), [wId]);
  // fix-r5 s2 item 8 (qa-coach 073256): S1's read, for the moves' real count (the app bar's "of m") and the coach's open
  // step on this move (the card's done form when R3 has no code left). Until it answers, or if it fails, the app bar
  // says nothing rather than a count it cannot back, and the step card behaves as before.
  const homeLoad = useLoad<Home>(() => coachip.home(), []);
  const home = homeLoad.data;
  // R6 fix cycle 1 (FIX_R6 A1): a line still coming is null (the app bar holds its box); a line that will not come is undefined
  const coming = error ? undefined : null;
  const card = data?.card;
  const m = home ? home.moves.length : 0;
  const laptop = useLaptop();
  return (
    <InsightsPage
      testId="insights-w"
      backTo={insightsPaths.thisWeek}
      title={card ? pick(card.short_name, lang) : coming}
      crumb={card && home ? (m >= card.rank ? <span data-nonum="">{t("s2.appbar.sub", lang, { k: card.rank, m })}</span> : undefined)
        : homeLoad.error ? undefined : coming}
      chips={card ? <MetaLine window={card.window} /> : coming}
      windows={data?.windows}
      screenWindow={card?.window.id ?? null}
      // laptop (SCREENS S2, ux-lead-2 174713 item 4): the step card (the primary, sticky) and the moment on the right
      aside={data && card && laptop ? <Act d={data} home={home} /> : undefined}
    >
      {!data || !card ? <StateBlock error={error} /> : <Fold d={data} home={home} laptop={laptop} />}
    </InsightsPage>
  );
}

/** The moment: its header is the way to S4, then the inline player with the strip. */
function MomentBlock({ moment, first = false }: { moment: Moment; first?: boolean }) {
  const lang = useLang();
  return (
    <section id="moment" data-testid="w-moment" data-section=""
      className={`flex flex-col gap-3 ${first ? "" : "mt-5 border-t border-cp-hairline pt-5"}`}>
      {/* fix-r5 s4 train 7 item 2 (design-qa 172524): the header is the way to S4 (the S1 "S-01 first ›" pattern),
          not a row of its own that pushes "Set this step" under the fixed nav on the shortest page */}
      <Link to={insightsPaths.moment(moment.moment_id)} data-testid="w-moment-head"
        className="-mx-1 flex min-h-[44px] items-center gap-2 rounded-xl px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <h2 className="text-[20px] font-bold leading-[1.3] text-cp-navy">{t("s2.moment.title", lang)}</h2>
          <span className={`text-[13px] text-cp-ink-3 ${isolateRuns(lang)}`}>
            {tx("s2.moment.sub", lang, {
              code: <CodeText lang={lang}>{moment.code.code}</CodeText>,
              school: <CodeText lang={lang}>{moment.school.school_name}</CodeText>,
            })}
          </span>
        </div>
        <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />
      </Link>
      <MomentSlot moment={moment} />
    </section>
  );
}

/** The laptop's right column: the step card (sticky with the column), then the moment. */
function Act({ d, home }: { d: WDetail; home: Home | null }) {
  const moment = d.card.status === "insufficient" ? null : d.moment;
  return (
    <div className="flex flex-col gap-6">
      <StepCard detail={d} openStep={openStepFor(d.card.w_id, home?.steps)} />
      {moment && <MomentBlock moment={moment} />}
    </div>
  );
}

function Fold({ d, home, laptop }: { d: WDetail; home: Home | null; laptop: boolean }) {
  const lang = useLang();
  const card = d.card;
  const insufficient = card.status === "insufficient";
  const moment = insufficient ? null : d.moment;
  // Why: the larger cause's bar is a notice (navy), the smaller one's grey (DESIGN_SYSTEM §5, FIX_R6 A5)
  const top = Math.max(0, ...d.split.map((r) => r.count?.n ?? 0));
  return (
    <div className="flex flex-col">
      <section data-testid="w-number" className="flex flex-col gap-2 pt-2">
        {/* no NOTICE eyebrow here: the app bar already names the move ("Move 1 of 2"); ONE MOVE and the moment follow */}
        <RingCount count={card.count} lang={lang} size="card">
          <p className="text-[15px] leading-[1.45] text-cp-ink">{pick(card.sentence, lang)}</p>
        </RingCount>
        {card.where_first && (
          <Link to={insightsPaths.where(card.w_id)} data-testid="w-where-first"
            className={`-mx-1 mt-1 flex min-h-[44px] items-center gap-2 rounded-xl px-1 text-[17px] font-semibold leading-[1.4] text-cp-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green ${isolateRuns(lang)}`}>
            <span className="min-w-0 flex-1">
              {card.where_first.visit
                ? tx("s1.where", lang, { school: <CodeText lang={lang}>{card.where_first.school.school_name}</CodeText>, date: <DateText iso={card.where_first.visit.date} lang={lang} /> }, [{ n: "n", d: "d", count: card.where_first.count }])
                : tx("s1.where.no_visit", lang, { school: <CodeText lang={lang}>{card.where_first.school.school_name}</CodeText> }, [{ n: "n", d: "d", count: card.where_first.count }])}
            </span>
            <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />
          </Link>
        )}
        {insufficient && (
          <NoteCard testId="w-insufficient">
            {tx("s2.insufficient", lang, {}, [{ n: "graded", d: "needed", count: { n: card.count.d, d: COACH_FLOOR, window_id: card.count.window_id } }])}
          </NoteCard>
        )}
      </section>

      {!laptop && (
        <>
          <div className="mt-4">
            <StepCard detail={d} openStep={openStepFor(card.w_id, home?.steps)} />
          </div>
          {moment && <MomentBlock moment={moment} />}
        </>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:gap-x-10">
      {(d.split.length > 0 || card.cause) && (
        <Section testId="w-split" label={t("s2.split.title", lang)}>
          {d.split.length > 0 && (
            <ul className="grid grid-cols-2 gap-x-6 gap-y-4 pt-1">
              {d.split.map((r) => (
                <li key={r.w_id} data-w={r.w_id} className="flex min-w-0 flex-col gap-1">
                  {r.count && <RowCount count={r.count} lang={lang} />}
                  <span className="text-[15px] leading-[1.4] text-cp-ink-2">{pick(r.short_name, lang)}</span>
                  {r.count && <FractionBar n={r.count.n} d={r.count.d} tone={r.count.n >= top ? "notice" : "grey"} className="mt-1" />}
                </li>
              ))}
            </ul>
          )}
          <CountSpan as="p" count={card.count} className="pt-3 text-[13px] leading-[1.45] text-cp-ink-3">
            {t("s2.split.denominator", lang, { d: card.count.d })}
          </CountSpan>
          {card.cause && (
            <p className="pt-3 text-[15px] leading-[1.45] text-cp-ink-2">
              <StatSpan stat={card.cause.stat}>{pick(card.cause.text, lang)}</StatSpan>
              {card.cause.also && <>{" "}<CountSpan count={card.cause.also.count}>{pick(card.cause.also.text, lang)}</CountSpan></>}
            </p>
          )}
        </Section>
      )}

      <Section testId="w-where" label={t("s2.where.title", lang)}>
        <ul className="flex flex-col">
          {d.schools.slice(0, 3).map((s) => (
            <li key={s.school.school_id} data-testid="w-where-row"
              className={`flex flex-col gap-2 border-t border-cp-hairline py-3.5 text-[17px] font-semibold leading-[1.4] text-cp-ink first:border-t-0 ${isolateRuns(lang)}`}>
              <span>{schoolLine(s, lang, "s2.where.row")}</span>
              <FractionBar n={s.count.n} d={s.count.d} />
            </li>
          ))}
        </ul>
        <Link to={insightsPaths.where(card.w_id)} data-testid="w-where-all"
          className="flex min-h-[44px] items-center text-[15px] font-semibold text-cp-green-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
          {t("s2.where.all", lang)}
        </Link>
      </Section>
      </div>

      <Section testId="w-good" label={t("s2.good.title", lang)}>
        <LibraryText as="p" className="text-[15px] leading-[1.45] text-cp-ink-2">{pick(d.good_looks_like, lang)}</LibraryText>
      </Section>

      <MethodSheet detail={d} />
    </div>
  );
}
