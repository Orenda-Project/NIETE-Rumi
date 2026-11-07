import { useEffect, useState } from "react";
import { HistoryRow } from "../ui";
import { LIST_CARD } from "../ui/styles";
import { useCopy } from "../i18n";
import { teacherPath } from "../routes";
import { Stats } from "../../coach/ui";
import { EmptyRow } from "../../coach/people/rows";
import { PEOPLE } from "../../coach/people/copy";
import { SCHOOL_CARD } from "../../coach/card/copy";
import { ANALYTICS } from "../analytics/copy";
import { getPrincipalSchoolCard, type PrincipalSchoolCard } from "./api";

/**
 * bd-33wxxi.2 — the principal's "My school" card on the Home (#55, Home A). A composition of existing pieces and no
 * styling of its own: the coach Schools row's shape (the kit's HistoryRow with the school lead, then the coach-local
 * Stats strip, in the kit's LIST_CARD), opening Analytics, whose first tab is My school. Words are the analytics and
 * School card copy's own ("My school" · "This week"; "N of M teachers used NIETE this week"; the four feature words,
 * Digital Coaching as the School card and the Home tile say it).
 *
 * The numbers are the server's for her own school, This week (GET /principal/school/card): lesson plans, Digital
 * Coaching sessions, modules completed, assessments. Unloaded or unreadable, every number is "—", never 0. Her row
 * naming no school: one slim "No school" row (EmptyRow).
 */
type Load = { status: "loading" | "error" } | { status: "ready"; card: PrincipalSchoolCard };

export function SchoolHomeCard() {
  const A = useCopy(ANALYTICS);
  const S = useCopy(SCHOOL_CARD);
  const P = useCopy(PEOPLE);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    let live = true;
    getPrincipalSchoolCard("week")
      .then((card) => { if (live) setLoad({ status: "ready", card }); })
      .catch(() => { if (live) setLoad({ status: "error" }); });
    return () => { live = false; };
  }, []);

  const card = load.status === "ready" ? load.card : null;
  if (card && !card.school) return <EmptyRow icon={<span>·</span>} testId="my-school-none">{P.noSchool}</EmptyRow>;
  const ov = card?.overview;
  const num = (v: number | null | undefined) => (v == null ? S.dash : v);
  return (
    <section className={LIST_CARD} data-testid="my-school-card">
      <HistoryRow lead="school" wrapTitle title={`${A.mySchool} · ${S.periods.week}`} to={teacherPath("analytics")}
        extra={ov ? `${S.nOfM(ov.active.now, ov.teachers)} ${S.usedNiete.week}` : undefined} />
      <Stats items={[
        { value: num(ov?.lp.total), label: S.featureName.lp },
        { value: num(card?.scores?.dc.count), label: S.digitalCoaching },
        { value: num(ov?.training.modules), label: S.featureName.training },
        { value: num(ov?.papers.total), label: S.featureName.papers },
      ]} />
    </section>
  );
}
