import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { CHEVRON, FOCUS, LIST_CARD, ROW_DIVIDER, ROW_SUB, ROW_TITLE } from "../../teacher/ui/styles";
import { SectionLabel } from "../ui";
import type { Row } from "./api";
import { DISAGREE } from "./copy";

/**
 * bd-tbprit.16 — "For your next visit" at the top of her disagreements list: the To-do requests she added with
 * "Add to my next visit" (bd-tbprit.11), each opening its card. Nothing when none is marked. It sits on the list, not
 * the coach Home, because coach app v2 sends Home to the Training Library (coach/training/appReady.ts).
 */
export function NextVisit({ todo }: { todo: Row[] }) {
  const C = useCopy(DISAGREE);
  const rows = todo.filter((r) => r.nextVisit);
  if (rows.length === 0) return null;
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
