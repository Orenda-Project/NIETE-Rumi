import { useMemo, useState } from "react";
import TeacherPage from "../TeacherPage";
import { useCopy } from "../i18n";
import { HistoryList, type HistoryItem } from "../ui";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { LESSONS } from "../lessons/copy";
import { dayName, pkDayOf, pkToday } from "../lessons/days";
import { LoadState } from "../lessons/LoadState";
import { OBSERVATIONS } from "../observations/copy";
import { OBS_HOME } from "../observations/paths";
import { coach } from "../../services/api";
import { SearchBox } from "../../coach/ui";
import { EmptyRow } from "../../coach/people/rows";
import { PEOPLE } from "../../coach/people/copy";
import { useLevelNames } from "../../coach/people/level";
import { OBSERVE } from "../../coach/observe/copy";
import { SCHOOL_CARD } from "../../coach/card/copy";
import { REPORTS } from "../../coach/reports/copy";
import { reportChip } from "../../coach/reports/ReportRows";
import type { CoachReport } from "../../coach/types";
import { getPrincipalSchoolCard } from "./api";
import { PRINCIPAL } from "./copy";
import { principalNewVisitPath } from "./observe";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { FOCUS } from "../ui/styles";
import { COACHING_NEW } from "../coaching/paths";
import { useFlowV6 } from "../../coach/flow/useCoachFlowV2";

/**
 * bd-33wxxi.4 — "One of my teachers" → Pick the teacher (#55, Observations A): her own school's teachers (GET
 * /principal/school/card: never herself, never another principal), A to Z, with the coach's SearchBox above the kit's
 * person rows. Line 2 is her level and when she last observed that teacher ("last observed Mon 5 Oct" / "not observed
 * yet"); an observation of hers not sent yet wears the Reports chip (Feedback Form, Debrief…). A row opens that teacher's
 * page, the coach's visit screen (bd-33wxxi.9.3: Start recording / Upload recording, the Teacher card) — no visit is
 * scheduled, so nothing goes to the teacher.
 * Her row naming no school: "No school".
 */
const WHOSE = "flex min-h-[48px] items-center justify-center rounded-xl px-3 text-center text-[15px] font-semibold leading-tight rtl:leading-[1.8]";

export function PickTeacher() {
  const O = useCopy(OBSERVATIONS);
  const B = useCopy(OBSERVE);
  const S = useCopy(SCHOOL_CARD);
  const P = useCopy(PRINCIPAL);
  const R = useCopy(REPORTS);
  const People = useCopy(PEOPLE);
  const { days } = useCopy(LESSONS);
  const levelNames = useLevelNames();
  const [q, setQ] = useState("");
  const [cardLoad, retryCard] = useLoad(() => getPrincipalSchoolCard("week"), "principal:pick:card");
  const [reportsLoad] = useLoad(() => coach.getReports({ page: 1 }), "principal:pick:reports");
  const card = dataOf(cardLoad);
  const reports = dataOf(reportsLoad);
  const today = pkToday();
  const v6 = useFlowV6() === true;

  // Her latest observation of each teacher, newest first (the reports come newest first).
  const latest = useMemo(() => {
    const m = new Map<string, CoachReport>();
    for (const r of reports?.all.items ?? []) if (r.teacherExtId && !m.has(r.teacherExtId)) m.set(r.teacherExtId, r);
    return m;
  }, [reports]);

  const rows: HistoryItem[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...(card?.teachers ?? [])]
      .filter((t) => !needle || t.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const last = latest.get(t.teacherExtId);
        const seen = last ? P.lastObserved(dayName(pkDayOf(last.createdAt) || "", today, days)) : P.notObserved;
        return {
          id: t.teacherExtId,
          lead: "person" as const,
          title: t.name,
          extra: [levelNames(t.levels), seen].filter(Boolean).join(" · "),
          chip: last && last.step !== "sent" ? reportChip(last, R) : null,
          // bd-31ziu8 — book the visit first, as a coach does (operator 18 Nov: "It has to be the same as coach"); the
          // visit screen (Start recording / Upload recording) opens from My schedule.
          to: principalNewVisitPath(t.teacherExtId),
        };
      });
  }, [card, latest, q, P, R, days, today, levelNames]);

  return (
    <TeacherPage feature="observations" title={B.pickTheTeacher} crumb={`${O.title} · ${P.oneTeacher}`} backTo={OBS_HOME}
      testId="principal-pick">
      {/* bd-o15qnr.28 (v6/v7, #188's board p7-pick): whose lesson — one of her teachers (this list) or her own (Digital
          Coaching's New observation, the teacher app's flow) */}
      {v6 && (
        <div data-testid="pick-whose" role="group" aria-label={B.pickTheTeacher} className="mb-1 grid grid-cols-2 gap-2">
          <span aria-current="true" className={cn(WHOSE, "bg-[#33374a] text-white")}>{P.oneTeacher}</span>
          <Link to={COACHING_NEW} className={cn(WHOSE, "border border-[#e5e7eb] bg-white text-[#33374a]", FOCUS)}>{P.ownLesson}</Link>
        </div>
      )}
      {!card ? <LoadState status={cardLoad.status} empty={false} onRetry={retryCard} /> : null}
      {card && !card.school ? <EmptyRow icon={<span>·</span>} testId="pick-no-school">{People.noSchool}</EmptyRow> : null}
      {card?.school ? (
        <>
          <SearchBox value={q} onChange={setQ} placeholder={S.teacherName} />
          {rows.length
            ? <HistoryList groups={[{ day: "", items: rows }]} showMore={false} />
            : <EmptyRow icon={<span>·</span>} testId="pick-none">{q ? S.noMatch : S.noTeachers}</EmptyRow>}
        </>
      ) : null}
    </TeacherPage>
  );
}
