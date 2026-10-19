import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { Chip } from "../../newui/Chip";
import { FOCUS, LIST_CARD, ROW_SUB, ROW_TITLE } from "../../teacher/ui/styles";
import { SectionLabel } from "../ui";
import { disagreements, type Row } from "./api";
import { DISAGREE } from "./copy";
import { DisagreementsFrame, Gated } from "./frame";

/**
 * bd-tbprit.3 — her list: To do (the API's order — most tags first, then longest waiting) and Done. Each row opens
 * the teacher's card. Missing data reads "—".
 */

function RowLink({ r }: { r: Row }) {
  const C = useCopy(DISAGREE);
  return (
    <Link to={`/portal/coach/disagreements/${r.id}`} className={cn(LIST_CARD, FOCUS, "flex min-h-[56px] flex-col gap-1.5 px-4 py-3")}>
      <span className={ROW_TITLE}>{r.teacher ?? C.dash}</span>
      <span className={ROW_SUB}>{r.school ?? C.dash}</span>
      {r.tags.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {r.tags.map((t) => <Chip key={t} tone="waiting">{C.tag[t]}</Chip>)}
        </span>
      )}
      <span className="text-[14px] leading-[1.4] text-[#1d2025]">
        {r.reasons.length ? r.reasons.map((code) => C.reason[code]).join(" · ") : C.dash}
      </span>
      <span className={ROW_SUB}>
        {r.pct == null ? C.dash : C.aiPct(r.pct)}
        {r.hasNote ? ` · ${C.hasNote}` : ""}
      </span>
    </Link>
  );
}

function Body() {
  const C = useCopy(DISAGREE);
  const [load, retry] = useLoad(() => disagreements.list(), "coach:disagreements");
  const data = dataOf(load);
  return (
    <DisagreementsFrame title={C.title} crumb={C.crumb} backTo="/portal/coach/reports" testId="coach-disagreements">
      <LoadState status={load.status} empty={false} onRetry={retry} />
      {data && (
        <>
          <div className="flex flex-col gap-2.5" data-testid="disagreements-todo">
            <SectionLabel countStyle="count" count={data.todo.length} countTone={data.todo.length ? "warn" : "info"}>{C.todo}</SectionLabel>
            {data.todo.length ? data.todo.map((r) => <RowLink key={r.id} r={r} />) : <p className={ROW_SUB}>{C.noneWaiting}</p>}
          </div>
          <div className="flex flex-col gap-2.5" data-testid="disagreements-done">
            <SectionLabel countStyle="count" count={data.done.length}>{C.done}</SectionLabel>
            {data.done.length ? data.done.map((r) => <RowLink key={r.id} r={r} />) : <p className={ROW_SUB}>{C.noneDone}</p>}
          </div>
        </>
      )}
    </DisagreementsFrame>
  );
}

export default function DisagreementsPage() {
  return <Gated><Body /></Gated>;
}
