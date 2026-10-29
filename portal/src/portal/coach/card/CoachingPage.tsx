import { useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { useCopy, useLang } from "../../teacher/i18n";
import { Loading } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useCardLoad } from "./frame";
import { pkDate, usePeriod, withPeriod } from "./period";
import { CoachingLines, CoachingRow, KindChips, PeriodChips, ScoreChart, chartDate, type CoachingShow } from "./parts";
import type { CoachingData, CoachingItem } from "./types";

/**
 * Her Observations page (/coaching, the switch on; design v8 A): her DC observations and her coach observations in the
 * period, together. The period chips, the same two-line summary and chart as her Observations card (information, so flat),
 * then the filter chips (All · Digital Coaching · Coach observations, each with its count, in the address as `?show=`) and
 * ONE list, newest first, both kinds mixed. A DC row opens the coach's view of that report; a coach observation is
 * information only. Under the list, the key to the B C D F strip, then "Only you see this". An empty period has one line,
 * no chips and no key.
 */

const SHOWS: readonly CoachingShow[] = ["all", "dc", "coach"];
const showOf = (raw: string | null): CoachingShow => ((SHOWS as readonly string[]).includes(raw ?? "") ? (raw as CoachingShow) : "all");
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const SECTION_CODES = ["B", "C", "D", "F"] as const;

/** The server's order is newest first; a stable sort by day keeps it within a day. */
const newestFirst = (xs: readonly CoachingItem[]) => [...xs].sort((a, b) => String(b.date).localeCompare(String(a.date)));

function Coaching() {
  const C = useCopy(SCHOOL_CARD);
  const lang = useLang();
  const { ext = "" } = useParams();
  const [period] = usePeriod();
  const [params, setParams] = useSearchParams();
  const show = showOf(params.get("show"));
  const setShow = useCallback((next: CoachingShow) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "all") p.delete("show"); else p.set("show", next);
      return p;
    }, { replace: true });
  }, [setParams]);
  const { data, failed, reload } = useCardLoad<CoachingData>(() => card.coaching(ext, period), [ext, period]);
  const known = useRef<CoachingData["teacher"] | null>(null);
  if (data?.teacher) known.current = data.teacher;
  const t = data?.teacher ?? known.current;
  const today = data?.period?.today ?? pkDate(new Date().toISOString()) ?? undefined;

  const all = newestFirst(data?.items ?? []);
  const rows = all.filter((i) => show === "all" || i.kind === show);
  const counts = { all: all.length, dc: all.filter((i) => i.kind === "dc").length, coach: all.filter((i) => i.kind === "coach").length };
  const sessionLink = (id: string) => withPeriod(`/portal/coach/session/${encodeURIComponent(id)}`, period);

  return (
    <PeopleFrame title={C.observations} crumb={t?.name || undefined} feature="schools"
      backTo={withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period)}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <section data-testid="coaching-summary" role="group" aria-label={C.observations}
            className="flex flex-col gap-2.5 rounded-[20px] bg-[#e9ebef] p-3.5 text-[#1d2025]">
            <CoachingLines summary={data.summary} flat />
            {data.chart?.some((p) => typeof p.score === "number")
              ? <ScoreChart points={data.chart} label={C.observations} aiWord={C.aiScore} coachWord={C.coachScore} dateLabel={chartDate(C)} height={128} />
              : <span data-testid="no-scores" className="py-1 text-[15px] font-semibold text-[#6b7280]">{C.noScores}</span>}
          </section>

          {!all.length
            ? <EmptyRow icon={<span>·</span>} testId="no-observations">{C.noObs[period]}</EmptyRow>
            : (
              <>
                <KindChips value={show} counts={counts} onChange={setShow} />
                {rows.length
                  ? (
                    <div data-testid="coaching-list" className={LIST}>
                      {rows.map((item, i) => (
                        <CoachingRow key={`${item.kind}-${item.id}`} item={item} today={today} lang={lang} first={i === 0} linkOf={sessionLink} />
                      ))}
                    </div>
                  )
                  : <EmptyRow icon={<span>·</span>} testId="no-observations">{(show === "dc" ? C.noDc : C.noCoachObsFilter)[period]}</EmptyRow>}
                <p data-testid="section-key" className="m-0 mx-1 flex flex-col gap-0.5 text-[13px] leading-[1.5] text-[#6b7280] rtl:leading-[1.9]">
                  {SECTION_CODES.map((k) => <span key={k}>{C.sectionKey(k, C.sectionNames[k])}</span>)}
                  <span>{C.notScoredKey(C.dash)}</span>
                </p>
              </>
            )}
          <p className="m-0 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-[#6b7280]">
            <Lock className="h-4 w-4" aria-hidden="true" />{C.onlyYou}
          </p>
        </>
      )}
    </PeopleFrame>
  );
}

export default function CoachingPage() {
  return <CardOnly><Coaching /></CardOnly>;
}
