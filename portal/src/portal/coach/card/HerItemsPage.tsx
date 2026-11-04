import { useLocation, useParams } from "react-router-dom";
import { HistoryList, KpiTiles, type HistoryItem } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { Loading } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD } from "./copy";
import { card } from "./api";
import { CardOnly, useBackTo, useCardLoad } from "./frame";
import { dayLabel, pkDate, usePeriod, withPeriod } from "./period";
import { FEATURE_OF, PeriodChips } from "./parts";
import { HerTrainings } from "./training";
import type { ItemsData, ItemsFeature, LpItem, PaperItem } from "./types";

/**
 * Her list of one feature in the period, newest first: Lesson plans and Assessments (her papers). Training is not a list
 * of the period: it is each of her trainings with the progress her own Training page shows (bd-hl4a4y), so it has no
 * period and no count. Her DC observations and coach visits are not lists here: they are her Coaching page (their old
 * addresses open it, CoachingRedirect).
 */

const FEATURES: readonly ItemsFeature[] = ["lp", "papers", "training"];

const newestFirst = <T extends { date: string }>(xs: readonly T[]) => [...xs].sort((a, b) => String(b.date).localeCompare(String(a.date)));

function HerItems() {
  const C = useCopy(SCHOOL_CARD);
  const { ext = "", feature: raw = "" } = useParams();
  const feature = (FEATURES as readonly string[]).includes(raw) ? (raw as ItemsFeature) : null;
  const [period] = usePeriod();
  const from = (useLocation().state || {}) as { teacherName?: string };
  const backTo = useBackTo(withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period));
  const { data, failed, reload } = useCardLoad<ItemsData>(
    () => (feature ? card.items(ext, feature, period) : Promise.reject(new Error("unknown feature"))), [ext, feature, period]);
  const today = data?.period?.today ?? pkDate(new Date().toISOString()) ?? undefined;

  const items = data?.items ?? [];
  const rows: HistoryItem[] = !feature ? [] : feature === "lp"
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

  const vendors = data?.vendors ?? [];

  return (
    <PeopleFrame title={feature ? C.allOf[feature] : C.dash} crumb={from.teacherName || undefined} feature={feature ? FEATURE_OF[feature] : "schools"}
      backTo={backTo}>
      {feature !== "training" && <PeriodChips />}
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && feature === "training" && (vendors.length
        ? <HerTrainings vendors={vendors} levels={data.levels} />
        : <EmptyRow icon={<span>·</span>} testId="empty">{C.noTraining}</EmptyRow>)}
      {data && feature && feature !== "training" && (
        <>
          <KpiTiles columns={2} items={[{ value: items.length, label: C.tiles[feature] }]} />
          {rows.length
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
