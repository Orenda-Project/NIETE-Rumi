import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { FOCUS } from "../../teacher/ui/styles";
import { disagreements, type Row, type Tag } from "./api";
import { DISAGREE } from "./copy";
import { DisagreementsFrame, Gated } from "./frame";

/**
 * bd-tbprit.7 — her list as Rifat's prototype draws it: her navy head (N, the app's name, Coach · ICT Islamabad,
 * EN | اردو; no back arrow), "Teachers who sent you their report", To do · N / Done · N
 * tabs, and one row per teacher: a blue dot until she opens the card (To do only), name, "School · EMIS n", the
 * server's tags in plain words (recording less is the red one), a chevron. To do keeps the API's order (most tags
 * first, then longest waiting). Missing data reads "—".
 */

const TAG = "rounded-md px-2 py-px text-[12px] font-bold leading-[1.5]";

function TagChip({ t }: { t: Tag }) {
  const C = useCopy(DISAGREE);
  const text = t.kind === "recordingLess" ? C.tag.recordingLess(t.before, t.now)
    : t.kind === "waiting" ? C.tag.waiting(t.days) : C.tag.repeat(t.nth);
  const red = t.kind === "recordingLess";
  return <span data-tone={red ? "red" : "soft"} className={cn(TAG, red ? "bg-[#c2552f] text-white" : "bg-[#fdece7] text-[#b8432a]")}>{text}</span>;
}

function RowLink({ r, todo }: { r: Row; todo: boolean }) {
  const C = useCopy(DISAGREE);
  return (
    <Link
      to={`/portal/coach/disagreements/${r.id}`}
      className={cn(FOCUS, "grid grid-cols-[12px_1fr_auto] items-center gap-2.5 rounded-[14px] border border-[#e1e4ea] bg-white p-3")}
    >
      <span className="flex justify-center">
        {todo && !r.opened && <span data-testid="unread-dot" className="h-2.5 w-2.5 rounded-full bg-[#3d5bd6]" />}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[16px] font-extrabold text-[#1d2025]">{r.teacher ?? C.dash}</span>
        <span className="text-[13px] text-[#5f6677]">{r.school && r.emis ? C.schoolEmis(r.school, r.emis) : r.school ?? C.dash}</span>
        {todo && r.tags.length > 0 && (
          <span className="flex flex-wrap gap-[5px]">{r.tags.map((t) => <TagChip key={t.kind} t={t} />)}</span>
        )}
        {!todo && (
          <span className="flex"><span className={cn(TAG, "border border-[#2f9a46] text-[#2f9a46]")}>{C.doneBadge}</span></span>
        )}
      </span>
      <span aria-hidden="true" className="text-[20px] text-[#5f6677] rtl:rotate-180">›</span>
    </Link>
  );
}

function TabButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(FOCUS, "min-h-[40px] flex-1 rounded-[10px] text-[14px] font-extrabold",
        selected ? "bg-[#2f3446] text-white" : "bg-transparent text-[#5f6677]")}
    >
      {children}
    </button>
  );
}

function Body() {
  const C = useCopy(DISAGREE);
  const [load, retry] = useLoad(() => disagreements.list(), "coach:disagreements");
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const data = dataOf(load);
  const rows = data ? data[tab] : [];
  return (
    <DisagreementsFrame title={C.appName} sub={C.appRole} mark="N" testId="coach-disagreements">
      <h1 className="text-[17px] font-extrabold text-[#1d2025]">{C.listTitle}</h1>
      <LoadState status={load.status} empty={false} onRetry={retry} />
      {data && (
        <>
          <div role="tablist" className="flex gap-1 rounded-[14px] border border-[#e1e4ea] bg-white p-1">
            <TabButton selected={tab === "todo"} onClick={() => setTab("todo")}>{C.todoTab(data.todo.length)}</TabButton>
            <TabButton selected={tab === "done"} onClick={() => setTab("done")}>{C.doneTab(data.done.length)}</TabButton>
          </div>
          <div role="tabpanel" className="flex flex-col gap-2" data-testid={`disagreements-${tab}`}>
            {rows.length
              ? rows.map((r) => <RowLink key={r.id} r={r} todo={tab === "todo"} />)
              : <p className="text-[14px] text-[#5f6677]">{tab === "todo" ? C.allDone : C.noneMarkedDone}</p>}
          </div>
        </>
      )}
    </DisagreementsFrame>
  );
}

export default function DisagreementsPage() {
  return <Gated><Body /></Gated>;
}
