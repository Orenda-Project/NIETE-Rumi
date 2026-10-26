import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import { CodeText, DateText, Num, StatSpan } from "../count";
import { durButton } from "../format";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { WCard as WCardData } from "../types";
import { Card, Eyebrow, MetaLine } from "./Frame";

/**
 * bd-sex15q.15 — S1's headline card (DESIGN §3 S1, COPY §S1): the cycle word and "Move k of m", the number line (a big
 * <Num>, then the server's sentence; number first in Urdu too), the cause line when the split is known, the meta line
 * the card's counts resolve to, the school to visit first, then [Listen m:ss] and [See the move].
 *
 * `total` is how many moves the page shows (1 or 2): it picks "Move 1 of 2" or "Move k of m". The phonics tile reuses
 * this card with its own `testId`. Codes and school names only, never a teacher's name.
 */
/**
 * CONVERGENCE §2's option (not a graft): "Listen m:ss" opens the clip IN PLACE on the card instead of going to S2. It
 * ships only if the card with the player open stays above the 704 px fold at 390×844 in both languages (m-ui measures
 * it with outputs/lanes/m-ui/measure/measure.py --expand). Open = the address carries `#listen`, so the phone's back
 * gesture closes it; one player at a time (the page holds one card). Off: the button goes to S2's moment.
 */
export const LISTEN_IN_PLACE = false;

/** The clip of the card's moment, through the authenticated stream route (B4), played on tap only. */
function InPlaceClip({ momentId }: { momentId: string }) {
  return (
    <div data-testid="wcard-clip" dir="ltr" data-clock="">
      <audio controls preload="none" src={`/api/portal/coachip/m/${encodeURIComponent(momentId)}/clip`} className="w-full">
        <track kind="captions" />
      </audio>
    </div>
  );
}

export function WCard({ card, total, testId = "wcard" }: { card: WCardData; total: number; testId?: string }) {
  const lang = useLang();
  const { hash } = useLocation();
  const open = LISTEN_IN_PLACE && hash === "#listen";
  const label = total === 2
    ? t(card.rank === 2 ? "s1.move_2" : "s1.move_1", lang)
    : t("s1.move_of", lang, { k: card.rank, m: Math.max(total, card.rank) });
  const wf = card.where_first;
  let where: ReactNode = null;
  if (wf) {
    const school = <CodeText lang={lang}>{wf.school.school_name}</CodeText>;
    where = wf.visit
      ? tx("s1.where", lang, { school, date: <DateText iso={wf.visit.date} lang={lang} /> }, [{ n: "n", d: "d", count: wf.count }])
      : tx("s1.where.no_visit", lang, { school }, [{ n: "n", d: "d", count: wf.count }]);
  }
  const then = wf && wf.then.length === 2
    ? tx("s1.where.then", lang, {
      school2: <CodeText lang={lang}>{wf.then[0].school_name}</CodeText>,
      school3: <CodeText lang={lang}>{wf.then[1].school_name}</CodeText>,
    })
    : null;
  // Listen and See the move share one row (each at least half the card, 48 px tall): the card ends higher on a phone.
  const btn = "flex min-h-[48px] min-w-[calc(50%-5px)] flex-1 items-center justify-center rounded-2xl px-3 text-[16px] font-semibold";
  return (
    <div data-testid={testId} data-w={card.w_id}>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <Eyebrow k="eyebrow.notice" />
          <span data-nonum="" className="rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[12.5px] font-semibold text-[#374151]">{label}</span>
        </div>
        <p className="flex flex-col gap-1">
          <Num count={card.count} lang={lang} className="text-[30px] font-bold leading-none tracking-[-0.01em] text-[#1d2025]" />
          <span className="text-[17px] font-medium leading-snug text-[#1d2025]">{pick(card.sentence, lang)}</span>
        </p>
        {card.cause && (
          <p className="text-[14.5px] leading-snug text-[#374151]">
            <StatSpan stat={card.cause.stat}>{pick(card.cause.text, lang)}</StatSpan>
            {/* the W-EXIT-TIME "also" line lives on S2 under Why, so the card ends above the fold */}
          </p>
        )}
        <MetaLine window={card.window} />
        {where && (
          <p data-testid={`${testId}-where`} className="text-[15px] font-semibold leading-snug text-[#1d2025] [overflow-wrap:anywhere]">
            {where}
            {then && <span className="block text-[13.5px] font-normal text-[#6b7280]">{then}</span>}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-2.5">
          {card.moment_id && card.moment_duration_s != null && (
            <Link data-testid={`${testId}-listen`} to={LISTEN_IN_PLACE ? "#listen" : `${insightsPaths.w(card.w_id)}#moment`}
              className={`${btn} border border-[#d1d5db] bg-white text-[#1d2025]`}>
              {/* one inline run: a flex button trims the space at the edge of a bare text run ("Listen0:38") */}
              <span>{tx("s1.listen", lang, { dur: <span data-clock="">{durButton(card.moment_duration_s, lang)}</span> })}</span>
            </Link>
          )}
          {open && card.moment_id && <div className="basis-full"><InPlaceClip momentId={card.moment_id} /></div>}
          <Link data-testid={`${testId}-see`} to={insightsPaths.w(card.w_id)} className={`${btn} bg-[#33374a] text-white`}>
            {t("s1.see_move", lang)}
          </Link>
        </div>
      </Card>
    </div>
  );
}
