import { Link, useParams } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { coachip } from "../api";
import { useLoad } from "../useLoad";
import { InsightsPage, Eyebrow, MetaLine, Card } from "../components/Frame";
import { NoteCard, StateBlock } from "../components/StateBlock";
import StepCard from "../components/StepCard";
import { schoolLine } from "../components/SchoolRow";
import MethodSheet from "../components/MethodSheet";
import MomentSlot from "../MomentSlot";
import { CodeText, CountSpan, LibraryText, Num, StatSpan } from "../count";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { WDetail } from "../types";

/**
 * bd-sex15q.15 — S2, one move in one fold (G1): `/w/:wId`, read from `GET /coachip/w/:wId`. Top to bottom: NOTICE, the
 * number line and sentence, the cause, the meta line (the card's window), why (the split on one denominator), where it
 * shows (three schools, then all), the moment (`#moment`, S1's Listen link lands here) with the inline player, the step
 * card, what good looks like, and the method sheet collapsed. The app bar says the short name, never "weakness".
 *
 * The read sits inside the gate, so with the switch off nothing is requested (B7).
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
  const card = data?.card;
  return (
    <InsightsPage
      testId="insights-w"
      backTo={insightsPaths.thisWeek}
      title={card ? pick(card.short_name, lang) : ""}
      crumb={card ? <span data-nonum="">{t("s2.appbar.sub", lang, { k: card.rank, m: 2 })}</span> : null}
      windows={data?.windows}
    >
      {!data || !card ? <StateBlock error={error} /> : <Fold d={data} />}
    </InsightsPage>
  );
}

function Fold({ d }: { d: WDetail }) {
  const lang = useLang();
  const card = d.card;
  const insufficient = card.status === "insufficient";
  const moment = insufficient ? null : d.moment;
  const title = "text-[15px] font-semibold text-[#1d2025]";
  return (
    <div className="flex flex-col gap-3">
      <Card testId="w-number">
        <Eyebrow k="eyebrow.notice" />
        <p className="text-[17px] leading-snug text-[#1d2025]">
          <Num count={card.count} lang={lang} className="text-[24px] font-bold" />{" "}
          <span>{pick(card.sentence, lang)}</span>
        </p>
        {card.cause && (
          <p className="text-[14px] leading-snug text-[#374151]">
            <StatSpan stat={card.cause.stat}>{pick(card.cause.text, lang)}</StatSpan>
            {card.cause.also && <>{" "}<CountSpan count={card.cause.also.count}>{pick(card.cause.also.text, lang)}</CountSpan></>}
          </p>
        )}
        <MetaLine window={card.window} />
        {insufficient && (
          <NoteCard testId="w-insufficient">
            {tx("s2.insufficient", lang, {}, [{ n: "graded", d: "needed", count: { n: card.count.d, d: COACH_FLOOR, window_id: card.count.window_id } }])}
          </NoteCard>
        )}
      </Card>

      {d.split.length > 0 && (
        <Card testId="w-split">
          <h2 className={title}>{t("s2.split.title", lang)}</h2>
          <ul className="flex flex-col gap-1.5">
            {d.split.map((r) => (
              <li key={r.w_id} data-w={r.w_id} className="flex items-baseline gap-2 text-[14.5px] leading-snug">
                {r.count && <Num count={r.count} lang={lang} className="shrink-0 font-bold text-[#1d2025]" />}
                <span className="text-[#374151]">{pick(r.short_name, lang)}</span>
              </li>
            ))}
          </ul>
          <CountSpan as="p" count={card.count} className="text-[12.5px] text-[#6b7280]">
            {t("s2.split.denominator", lang, { d: card.count.d })}
          </CountSpan>
        </Card>
      )}

      <Card testId="w-where">
        <h2 className={title}>{t("s2.where.title", lang)}</h2>
        <ul className="flex flex-col gap-1.5">
          {d.schools.slice(0, 3).map((s) => (
            <li key={s.school.school_id} data-testid="w-where-row" className="text-[14px] leading-snug text-[#374151] [overflow-wrap:anywhere]">
              {schoolLine(s, lang, "s2.where.row")}
            </li>
          ))}
        </ul>
        <Link to={insightsPaths.where(card.w_id)} data-testid="w-where-all" className="flex min-h-[44px] items-center text-[14.5px] font-semibold text-[#2f6f4f]">
          {t("s2.where.all", lang)}
        </Link>
      </Card>

      {moment && (
        <section id="moment" data-testid="w-moment" className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className={title}>{t("s2.moment.title", lang)}</h2>
            <span className="text-[13.5px] text-[#6b7280]">
              {tx("s2.moment.sub", lang, {
                code: <CodeText lang={lang}>{moment.code.code}</CodeText>,
                school: <CodeText lang={lang}>{moment.school.school_name}</CodeText>,
              })}
            </span>
          </div>
          <MomentSlot moment={moment} />
        </section>
      )}

      <StepCard detail={d} />

      <Card testId="w-good">
        <h2 className={title}>{t("s2.good.title", lang)}</h2>
        <LibraryText as="p" className="text-[14px] leading-snug text-[#374151]">{pick(d.good_looks_like, lang)}</LibraryText>
      </Card>

      <MethodSheet detail={d} />
    </div>
  );
}
