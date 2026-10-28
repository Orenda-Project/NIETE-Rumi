import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Headphones } from "lucide-react";
import { useLang, type Lang } from "../../../teacher/i18n";
import { CodeText, DateText, StatSpan } from "../count";
import { durButton } from "../format";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { WCard as WCardData } from "../types";
import { Eyebrow as CpEyebrow } from "../../../coachip-ui/Band";
import { RingCount } from "../../../coachip-ui/Count";
import { Button } from "../../../coachip-ui/Button";
import { Surface } from "../../../coachip-ui/Surface";
import { MetaLine } from "./Frame";
import { isolateRuns } from "./bidi";

/**
 * bd-sex15q.15, restyled bd-sex15q.46 (R6) — S1's headline move (DESIGN §3 S1, COPY §S1, design/r6 merged_S1_390).
 *
 * R6 splits the card by surface (DIRECTION "merge by surface"):
 *   WCardHero  the band's body: NOTICE · MOVE k OF m, the ONE headline count in the 104 px ring, the server's sentence
 *              beside it (the cause is on S2 under Why), the window as the band's green pill (the element the count's `data-win` resolves to).
 *              On a laptop the band's body is the hero card (coachip-ui tokens.css).
 *   WCard      the overlapping card right under the band: the school to visit first, then [Listen m:ss] (secondary) and
 *              [See the move] (the screen's ONE primary), inside the 704 px fold at 390×844.
 *   WCard inHero  on a laptop the same row sits inside the hero card under a hairline (one card, merged_S1_1440).
 *   WCard flat the phonics move (`flat`): the same move as hairline content under the phonics label, both buttons
 *              secondary (one primary per screen), the count as a card ring.
 *
 * `total` is how many moves the page shows (1 or 2): it picks "Move 1 of 2" or "Move k of m". Codes and school names
 * only, never a teacher's name.
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

function moveLabel(card: WCardData, total: number, lang: Lang): string {
  return total === 2
    ? t(card.rank === 2 ? "s1.move_2" : "s1.move_1", lang)
    : t("s1.move_of", lang, { k: card.rank, m: Math.max(total, card.rank) });
}

/** The window as a pill: the card's MetaLine (range · grader · scoring changed), drawn green on the band. */
const WINDOW_PILL = "self-start rounded-full bg-cp-green px-3 py-[5px] text-[12px] font-semibold leading-[1.45] text-cp-navy";

/** The band's body on S1: eyebrow, ring + "of d", the sentence and cause, the window pill. */
export function WCardHero({ card, total }: { card: WCardData; total: number }) {
  const lang = useLang();
  return (
    <div data-testid="wcard-hero" data-w={card.w_id} className="flex flex-col gap-3">
      <CpEyebrow>
        {t("eyebrow.notice", lang)}{lang === "ur" ? "، " : " · "}<span data-nonum="">{moveLabel(card, total, lang)}</span>
      </CpEyebrow>
      <RingCount count={card.count} lang={lang} size="hero">
        {/* the cause is S2's Why (merged_S1_390 has none in the band): the band stays short, the primary inside the fold */}
        <p className="text-[17px] font-medium leading-[1.42]">{pick(card.sentence, lang)}</p>
      </RingCount>
      <MetaLine window={card.window} className={WINDOW_PILL} />
    </div>
  );
}

function whereLine(card: WCardData, lang: Lang): { where: ReactNode; then: ReactNode } {
  const wf = card.where_first;
  if (!wf) return { where: null, then: null };
  const school = <CodeText lang={lang}>{wf.school.school_name}</CodeText>;
  const where = wf.visit
    ? tx("s1.where", lang, { school, date: <DateText iso={wf.visit.date} lang={lang} /> }, [{ n: "n", d: "d", count: wf.count }])
    : tx("s1.where.no_visit", lang, { school }, [{ n: "n", d: "d", count: wf.count }]);
  const then = wf.then.length === 2
    ? tx("s1.where.then", lang, {
      school2: <CodeText lang={lang}>{wf.then[0].school_name}</CodeText>,
      school3: <CodeText lang={lang}>{wf.then[1].school_name}</CodeText>,
    })
    : null;
  return { where, then };
}

export function WCard({ card, total, testId = "wcard", flat = false, inHero = false }: {
  card: WCardData; total: number; testId?: string; flat?: boolean; inHero?: boolean;
}) {
  const lang = useLang();
  const { hash } = useLocation();
  const open = LISTEN_IN_PLACE && hash === "#listen";
  const { where, then } = whereLine(card, lang);
  const listen = card.moment_id && card.moment_duration_s != null && (
    <Button
      variant="secondary"
      to={LISTEN_IN_PLACE ? "#listen" : `${insightsPaths.w(card.w_id)}#moment`}
      testId={`${testId}-listen`}
      className="min-w-0 flex-1"
      icon={<Headphones size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />}
    >
      {/* one inline run: a flex button trims the space at the edge of a bare text run ("Listen0:38") */}
      <span>{tx("s1.listen", lang, { dur: <span data-clock="">{durButton(card.moment_duration_s, lang)}</span> })}</span>
    </Button>
  );
  const actions = (
    <div className="flex flex-wrap gap-3">
      {listen}
      {open && card.moment_id && <div className="basis-full"><InPlaceClip momentId={card.moment_id} /></div>}
      <Button variant={flat ? "secondary" : "primary"} to={insightsPaths.w(card.w_id)} testId={`${testId}-see`} className="min-w-0 flex-1">
        <span>{t("s1.see_move", lang)}</span>
      </Button>
    </div>
  );
  const whereNode = where && (
    <Link
      to={insightsPaths.where(card.w_id)}
      data-testid={`${testId}-where`}
      className="-mx-1 flex min-h-[44px] items-center gap-2 rounded-xl px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green"
    >
      <span className={`min-w-0 flex-1 text-[17px] font-semibold leading-[1.4] text-cp-ink ${isolateRuns(lang)}`}>
        {where}
        {then && <span className={`block text-[13px] font-normal leading-[1.45] text-cp-ink-3 ${isolateRuns(lang)}`}>{then}</span>}
      </span>
      <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );

  if (flat) {
    return (
      <div data-testid={testId} data-w={card.w_id} className="flex flex-col gap-3">
        <CpEyebrow>
          {t("eyebrow.notice", lang)}{lang === "ur" ? "، " : " · "}<span data-nonum="">{moveLabel(card, total, lang)}</span>
        </CpEyebrow>
        <RingCount count={card.count} lang={lang} size="card">
          <p className="text-[15px] leading-[1.45] text-cp-ink">{pick(card.sentence, lang)}</p>
        </RingCount>
        {card.cause && (
          <p className="text-[13px] leading-[1.45] text-cp-ink-2">
            <StatSpan stat={card.cause.stat}>{pick(card.cause.text, lang)}</StatSpan>
          </p>
        )}
        <MetaLine window={card.window} />
        {whereNode}
        {actions}
      </div>
    );
  }

  const row = (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
      <div className="min-w-0 lg:flex-1">{whereNode}</div>
      <div className="lg:w-[340px] lg:shrink-0">{actions}</div>
    </div>
  );
  // laptop (≥ 1024): the same row inside the band's hero card under a hairline (merged_S1_1440: ONE card)
  if (inHero) {
    return <div data-testid={testId} data-w={card.w_id} className="mt-2 border-t border-cp-hairline pt-6">{row}</div>;
  }
  return <Surface overlap testId={testId} data-w={card.w_id}>{row}</Surface>;
}
