import { useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronRight, Lock } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { Loading, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { WHERE, type WhereCopy } from "./whereCopy";
import { where, type CoachFirstData, type CoachFirstGroup, type CoachFirstRow } from "./where";
import { CardOnly, useBackTo, useCardLoad } from "./frame";
import { usePeriod, withPeriod } from "./period";
import { PeriodChips } from "./parts";

/**
 * WHO TO COACH FIRST (bd-17v39c.4.14), coach only, its own page behind a button on the School card (Rifat's pick 2A, so
 * the School view stays shareable as it is). OURS: her spec has no rule for ranking teachers. The server runs her DC
 * pattern engine for every teacher and puts each in the first group that fits: both scored it low · low in most of her
 * lessons · no DC observation · one lesson so far · no low pattern. Each row names her focus practice (the one her Where
 * to coach opens with) and opens it. "No low pattern" starts folded. Opens on This month, with the chips to change it.
 */
const CARD = "overflow-hidden rounded-[20px] border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const TAP = "transition-colors hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]";
const META = "text-[13px] font-semibold leading-[1.4] text-[#6b7280] rtl:leading-[1.9]";

function subOf(row: CoachFirstRow, W: WhereCopy): string {
  switch (row.group) {
    case "agree_low": return W.counts(row.sessions.dc, row.sessions.coach);
    case "low_most": return row.k != null && row.n != null ? W.lowIn(row.k, row.n) : "";
    case "no_dc": return W.lastDc(row.lastDcDaysAgo);
    case "one_dc": return W.oneSession;
    default: return W.counts(row.sessions.dc, row.sessions.coach);
  }
}

function Row({ row, W, first, to, back }: { row: CoachFirstRow; W: WhereCopy; first: boolean; to: string; back: string }) {
  return (
    <Link to={to} state={{ back }} data-testid="first-row" data-group={row.group} data-ext={row.teacherExtId}
      className={`flex min-h-[72px] items-center gap-3 bg-white px-3.5 py-2.5 text-[#1d2025] ${TAP} ${first ? "" : "border-t border-[#f0f1f3]"}`}>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b dir="auto" className="text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]"><bdi>{row.name}</bdi></b>
        {row.focus && (
          <span className="flex items-center gap-1.5 text-[14px]">
            <span dir="ltr" className="inline-flex h-[22px] shrink-0 items-center rounded-md bg-[#33374a] px-1.5 text-[12px] font-extrabold text-white">{row.focus.id}</span>
            <span dir="auto" className="min-w-0 truncate">{row.focus.name}</span>
          </span>
        )}
        <span className={META}>{subOf(row, W)}</span>
      </span>
      <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}

function CoachFirst() {
  const W = useCopy(WHERE);
  const { emis = "" } = useParams();
  const { pathname, search } = useLocation();
  const [period] = usePeriod();
  const backTo = useBackTo(withPeriod(`/portal/coach/school/${encodeURIComponent(emis)}`, period));
  const { data: d, failed, reload } = useCardLoad<CoachFirstData>(() => where.school(emis, period), [emis, period]);
  const [showNone, setShowNone] = useState(false);
  const known = useRef<string | null>(null);
  if (d?.school?.name) known.current = d.school.name;
  const here = `${pathname}${search}`;
  const unit = W.unit[period];
  const title = (key: CoachFirstGroup) => (key === "no_dc" ? W.groups.no_dc(unit) : W.groups[key]);
  const whereOf = (ext: string) => withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}/where`, period);

  return (
    <PeopleFrame title={W.firstTitle} crumb={known.current || undefined} feature="schools" backTo={backTo}>
      <div className="mx-1 flex flex-col gap-1">
        {d && <span className={META}>{W.teachersN(d.teachers)}</span>}
        <span data-testid="coach-only" className="flex items-center gap-1.5 text-[13px] font-semibold text-[#b45309]">
          <Lock className="h-4 w-4" aria-hidden="true" />{W.never}
        </span>
      </div>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!d && !failed && <Loading />}
      {d && d.groups.filter((g) => g.rows.length).map((g) => {
        const folded = g.key === "none" && !showNone;
        return (
          <div key={g.key} data-testid="first-group" data-group={g.key} className="flex flex-col gap-2">
            <SectionLabel count={g.rows.length}
              right={g.key === "none"
                ? <button type="button" aria-expanded={!folded} onClick={() => setShowNone((s) => !s)} className={`min-h-[44px] rounded-lg px-2 text-[14px] font-semibold text-[#33374a] ${TAP}`}>{folded ? W.show(g.rows.length) : W.hide}</button>
                : undefined}>
              {title(g.key)}
            </SectionLabel>
            {!folded && (
              <section className={CARD}>
                {g.rows.map((r, i) => <Row key={r.teacherExtId} row={r} W={W} first={i === 0} to={whereOf(r.teacherExtId)} back={here} />)}
              </section>
            )}
          </div>
        );
      })}
      {d && (
        <section data-testid="first-how" className="rounded-[20px] bg-[#f9fafb] px-3.5 py-3">
          <b className="text-[15px]">{W.howH}</b>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {W.how.map((line) => <li key={line} className={META}>{line}</li>)}
          </ul>
        </section>
      )}
    </PeopleFrame>
  );
}

export default function CoachFirstPage() {
  return <CardOnly><CoachFirst /></CardOnly>;
}
