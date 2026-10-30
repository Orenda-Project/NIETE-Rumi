import { useLocation, useParams } from "react-router-dom";
import { useCopy } from "../../teacher/i18n";
import { FEATURE_HUE } from "../../teacher/icons/features";
import { Loading } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useCardLoad } from "./frame";
import { dayLabel, pkDate, usePeriod, withPeriod } from "./period";
import { FEATURE_OF, GLYPH, PeriodChips } from "./parts";
import type { CardFeature, TeacherCardData } from "./types";

/**
 * Her days (/teacher/:ext/days, bd-dgfkgs.4; operator 30 Oct: "8/21 isn't clear instrument by instrument"): each school
 * day in the period she used NIETE, newest first, with the instruments she used that day, each in its feature's colour.
 * The same answer as her page (the teacher card's days tile), so the two always agree. Information only.
 */
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

function UsedOn({ feature }: { feature: CardFeature }) {
  const C = useCopy(SCHOOL_CARD);
  const Glyph = GLYPH[feature];
  const hue = FEATURE_HUE[FEATURE_OF[feature]];
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold" style={{ background: hue.bg, color: hue.fg }}>
      <Glyph className="h-[15px] w-[15px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span data-feature={feature}>{feature === "dc" ? C.digitalCoaching : C.tiles[feature]}</span>
    </span>
  );
}

function HerDays() {
  const C = useCopy(SCHOOL_CARD);
  const { ext = "" } = useParams();
  const [period] = usePeriod();
  const from = (useLocation().state || {}) as { teacherName?: string };
  const { data, failed, reload } = useCardLoad<TeacherCardData>(() => card.teacher(ext, period), [ext, period]);
  const today = data?.period?.today ?? pkDate(new Date().toISOString()) ?? undefined;
  const uses = [...(data?.tiles?.days?.uses ?? [])].sort((a, b) => b.day.localeCompare(a.day));

  return (
    <PeopleFrame title={C.daysTitle} crumb={data?.teacher?.name || from.teacherName || undefined} feature="schools"
      backTo={withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period)}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (uses.length
        ? (
          <section data-testid="used-days" className={LIST}>
            {uses.map((u, i) => (
              <div key={u.day} data-testid="used-day" className={`flex min-h-[64px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 ${i ? "border-t border-[#f0f1f3]" : ""}`}>
                <b className="min-w-[96px] text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]">{dayLabel(u.day, today, C)}</b>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">{u.features.map((f) => <UsedOn key={f} feature={f} />)}</span>
              </div>
            ))}
          </section>
        )
        : <EmptyRow icon={<span>·</span>} testId="empty">{C.nothing[period]}</EmptyRow>)}
    </PeopleFrame>
  );
}

export default function DaysUsedPage() {
  return <CardOnly><HerDays /></CardOnly>;
}
