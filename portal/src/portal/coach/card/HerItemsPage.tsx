import { useLocation, useParams } from "react-router-dom";
import { Check, Circle } from "lucide-react";
import { HistoryList, KpiTiles, StatusChip, type HistoryItem } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { Loading } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useCardLoad } from "./frame";
import { dayLabel, pkDate, usePeriod, withPeriod } from "./period";
import { FEATURE_OF, PeriodChips } from "./parts";
import type { CoachItem, DcItem, ItemsData, ItemsFeature, LpItem, PaperItem, TrainingCourse } from "./types";

/**
 * Her list of one feature in the period, newest first: DC observations (a row opens the coach's view of that DC report),
 * Coach observations (information only: a coach visit's report lives in Observe, which the coach app does not show),
 * Lesson plans, Papers, and Training (each course and its parts, with the day each part was done).
 */

const FEATURES: readonly ItemsFeature[] = ["dc", "coach", "lp", "papers", "training"];
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

const newestFirst = <T extends { date: string }>(xs: readonly T[]) => [...xs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
const initials = (name: string | null | undefined) => {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return w.length ? (Array.from(w[0])[0] + (w.length > 1 ? Array.from(w[w.length - 1])[0] : "")).toUpperCase() : "·";
};

function Training({ courses, today }: { courses: readonly TrainingCourse[]; today: string | undefined }) {
  const C = useCopy(SCHOOL_CARD);
  return (
    <div data-testid="training-courses" className="flex flex-col gap-2.5">
      {courses.map((c) => {
        const done = c.parts.filter((p) => !!p.doneAt).length;
        return (
          <section key={c.name} data-testid="course" className={LIST}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <b dir="auto" className="min-w-0 flex-1 text-[16px] font-bold leading-[1.3]">{c.name}</b>
              <StatusChip text={c.done ? C.done : C.partsDone(done, c.parts.length)} tone={c.done ? "done" : "info"} />
            </div>
            {c.parts.map((p) => (
              <div key={p.name} data-testid="part" className="flex min-h-[52px] items-center gap-3 border-t border-[#f0f1f3] px-4 py-2 text-[15px]">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${p.doneAt ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#f3f4f6] text-[#9ca3af]"}`} aria-hidden="true">
                  {p.doneAt ? <Check className="h-4 w-4" strokeWidth={3} /> : <Circle className="h-3 w-3" />}
                </span>
                <span dir="auto" className="min-w-0 flex-1">{p.name}</span>
                <span className="shrink-0 text-[13px] font-semibold text-[#6b7280]">{p.doneAt ? dayLabel(p.doneAt, today, C) : C.notDone}</span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function HerItems() {
  const C = useCopy(SCHOOL_CARD);
  const { ext = "", feature: raw = "" } = useParams();
  const feature = (FEATURES as readonly string[]).includes(raw) ? (raw as ItemsFeature) : null;
  const [period] = usePeriod();
  const from = (useLocation().state || {}) as { teacherName?: string };
  const { data, failed, reload } = useCardLoad<ItemsData>(
    () => (feature ? card.items(ext, feature, period) : Promise.reject(new Error("unknown feature"))), [ext, feature, period]);
  const today = pkDate(new Date().toISOString()) ?? undefined;

  const items = data?.items ?? [];
  const rows: HistoryItem[] = !feature ? [] : feature === "dc"
    ? newestFirst(items as DcItem[]).map((d) => ({
      id: d.sessionId, lead: "grade" as const, grade: d.grade, subject: d.subject ?? "", title: dayLabel(d.date, today, C),
      chip: d.aiScore == null ? null : { text: C.aiScoreN(Math.round(d.aiScore)), tone: "score" as const },
      to: `/portal/coach/session/${encodeURIComponent(d.sessionId)}`, action: "chevron" as const,
    }))
    : feature === "coach"
      ? newestFirst(items as CoachItem[]).map((o) => ({
        id: o.id, lead: "person" as const, leadText: initials(o.coachName), title: dayLabel(o.date, today, C),
        extra: o.coachName ? C.coachBy(o.coachName) : undefined,
        // A visit on the field form is counted, never mixed with the observation scores.
        chip: o.form === "observe2" ? { text: C.fieldForm, tone: "info" as const } : o.score == null ? null : { text: C.coachScoreN(Math.round(o.score)), tone: "score" as const },
        action: "none" as const,
      }))
      : feature === "lp"
        ? newestFirst(items as LpItem[]).map((l) => ({
          id: l.id, lead: "grade" as const, grade: l.grade, subject: l.subject ?? "", title: l.title || dayLabel(l.date, today, C),
          extra: l.title ? dayLabel(l.date, today, C) : undefined, action: "none" as const,
        }))
        : feature === "papers"
          ? newestFirst(items as PaperItem[]).map((p) => ({
            id: p.id, lead: "grade" as const, grade: p.grade, subject: p.subject ?? "", title: dayLabel(p.date, today, C),
            extra: p.questions != null && p.marks != null ? C.questionsMarks(p.questions, p.marks) : p.questions != null ? C.questionsN(p.questions) : undefined,
            action: "none" as const,
          }))
          : [];

  const scored = feature === "dc" ? (items as DcItem[]).map((d) => d.aiScore).filter((s): s is number => typeof s === "number") : [];
  const coachScored = feature === "coach" ? (items as CoachItem[]).filter((o) => o.form !== "observe2").map((o) => o.score).filter((s): s is number => typeof s === "number") : [];
  const mean = (xs: number[]) => (xs.length ? `${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)}%` : null);
  const courses = data?.courses ?? [];
  const count = feature === "training" ? courses.reduce((n, c) => n + c.parts.filter((p) => !!p.doneAt).length, 0) : items.length;

  return (
    <PeopleFrame title={feature ? C.allOf[feature] : C.dash} crumb={from.teacherName || undefined} feature={feature ? FEATURE_OF[feature] : "schools"}
      backTo={withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period)}>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && feature && (
        <>
          <KpiTiles columns={2} items={[
            { value: count, label: feature === "training" ? C.tiles.training : C.tiles[feature] },
            ...(feature === "dc" ? [{ value: mean(scored), label: C.aiScore }] : []),
            ...(feature === "coach" ? [{ value: mean(coachScored), label: C.coachScore }] : []),
          ]} />
          {feature === "training"
            ? (courses.length ? <Training courses={courses} today={today} /> : <EmptyRow icon={<span>·</span>} testId="empty">{C.nothing[period]}</EmptyRow>)
            : rows.length
              ? <div data-testid="her-items"><HistoryList groups={[{ day: "", items: rows }]} showMore={false} /></div>
              : <EmptyRow icon={<span>·</span>} testId="empty">{C.nothing[period]}</EmptyRow>}
        </>
      )}
    </PeopleFrame>
  );
}

export default function HerItemsPage() {
  return <CardOnly><HerItems /></CardOnly>;
}
