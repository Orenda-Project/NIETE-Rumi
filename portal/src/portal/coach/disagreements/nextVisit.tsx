import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { CHEVRON, FOCUS, LIST_CARD, ROW_DIVIDER, ROW_SUB, ROW_TITLE } from "../../teacher/ui/styles";
import { SectionLabel } from "../ui";
import { disagreements, type Row } from "./api";
import { useDisagreementsOn } from "./frame";
import { DISAGREE } from "./copy";

/**
 * bd-tbprit.16 — the coach Home's "For your next visit": the To-do requests she added with "Add to my next visit"
 * (bd-tbprit.11), each opening its card. Nothing unless the flag is on and at least one is marked; a failed list
 * shows nothing rather than an error on her Home.
 */
export function NextVisit() {
  const C = useCopy(DISAGREE);
  const on = useDisagreementsOn();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (on !== true) return;
    let live = true;
    disagreements.list()
      .then((l) => { if (live) setRows(l.todo.filter((r) => r.nextVisit)); })
      .catch(() => {});
    return () => { live = false; };
  }, [on]);

  if (on !== true || rows.length === 0) return null;
  return (
    <section data-testid="next-visit" className="flex flex-col gap-2">
      <SectionLabel count={rows.length}>{C.nextVisit}</SectionLabel>
      <div className={LIST_CARD}>
        {rows.map((r, i) => (
          <Link key={r.id} to={`/portal/coach/disagreements/${encodeURIComponent(r.id)}`}
            className={cn(FOCUS, i > 0 && ROW_DIVIDER, "flex min-h-[56px] items-center gap-3 px-4 py-3")}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn(ROW_TITLE, "truncate")}>{r.teacher ?? C.dash}</span>
              {r.school && <span className={cn(ROW_SUB, "truncate")}>{r.school}</span>}
            </span>
            <ChevronRight className={cn(CHEVRON, "h-5 w-5")} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}
