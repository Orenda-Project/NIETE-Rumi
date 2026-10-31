import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui";
import { FOCUS } from "../../teacher/ui/styles";
import { TRAINING } from "../../teacher/training/copy";
import { courseTiles, TRAINING_V2_BASE } from "../../teacher/training/model";
import { ProviderMark, ProviderRing, useTileLine } from "../../teacher/training/TrainingFrame";
import { providerShort, trainingPaths } from "../../newui/training/trainingApi";
import { SCHOOL_CARD } from "./copy";
import type { TrainingByTeacherData, TrainingLevelState, TrainingProgress } from "./types";

/**
 * bd-hl4a4y (operator, 31 Oct: "just show the progress of all the trainings ... NIETE 9/10 done or percentage ... instead
 * of parts") — a teacher's trainings on the School card, each with the numbers HER OWN Training page shows: the same
 * tiles (courseTiles: the % of its parts done, "Level 3 of 4" or "3 of 5 courses", Done), the same ring, the same words.
 */
const LIST = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
// courseTiles also says where each tile would open; the coach's rows open nothing, so any base will do.
const PATHS = trainingPaths(TRAINING_V2_BASE);

/** Her trainings: a flat row each (information, not a way in): ring, name, then the line or Done. */
export function HerTrainings({ vendors, levels }: { vendors: TrainingProgress[]; levels: TrainingLevelState[] | null | undefined }) {
  const T = useCopy(TRAINING);
  const line = useTileLine();
  return (
    <section data-testid="her-trainings" className={LIST}>
      {courseTiles(vendors, levels ?? [], PATHS).map((t) => (
        <div key={t.key} data-testid="training-progress" className="flex min-h-[84px] items-center gap-3.5 border-t border-[#f0f1f3] px-4 py-3 first:border-t-0">
          <ProviderRing logo={t.logo} initials={t.initials} ring={{ pct: t.pct, done: t.done, label: t.done ? T.done : T.pct(t.pct) }} />
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <b dir="auto" className={cn("font-semibold leading-tight", Array.from(t.label).length > 32 ? "text-[15px]" : "text-[17px]")}>{t.label}</b>
            {t.done ? <StatusChip text={T.done} tone="done" /> : <span className="text-[14px] text-[#4b5563]">{line(t)}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * Training by teacher: a row per teacher (it opens her Training page), under her name each of her trainings, its mark,
 * short name and %, or Done. A teacher with none says so, grey; the server puts them last.
 */
export function TrainingByTeacher({ rows, linkOf, stateOf }: {
  rows: TrainingByTeacherData["rows"];
  linkOf: (ext: string | null) => string | null;
  stateOf: (ext: string | null, name: string) => unknown;
}) {
  const C = useCopy(SCHOOL_CARD);
  const T = useCopy(TRAINING);
  return (
    <section data-testid="training-by-teacher" className={LIST}>
      {rows.map((r) => {
        const none = r.vendors.length === 0;
        const to = linkOf(r.teacherExtId);
        const body = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span dir="auto" className={cn("text-[16px] font-semibold", none && "text-[#6b7280]")}>{r.name}</span>
              {none ? <span className="text-[14px] text-[#6b7280]">{C.noTraining}</span> : (
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  {courseTiles(r.vendors, [], PATHS).map((t) => (
                    <span key={t.key} data-testid="teacher-training" className="inline-flex items-center gap-1.5 text-[14px] text-[#4b5563]">
                      <ProviderMark logo={t.logo} initials={t.initials} size={18} />
                      <span>{providerShort(t.key, t.label)}</span>
                      <b className={cn("font-bold", t.done ? "text-[#2f7a52]" : "text-[#1d2025]")}>{t.done ? T.done : T.pct(t.pct)}</b>
                    </span>
                  ))}
                </span>
              )}
            </span>
            {to && <ChevronRight className="h-5 w-5 shrink-0 text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />}
          </>
        );
        const row = "flex min-h-[64px] items-center gap-3 border-t border-[#f0f1f3] px-4 py-3 first:border-t-0";
        return to ? (
          <Link key={r.teacherExtId || r.name} to={to} state={stateOf(r.teacherExtId, r.name)} data-testid="training-row" data-none={none ? "1" : undefined}
            className={cn(row, "hover:bg-[#f9fafb]", FOCUS)}>{body}</Link>
        ) : (
          <div key={r.teacherExtId || r.name} data-testid="training-row" data-none={none ? "1" : undefined} className={row}>{body}</div>
        );
      })}
    </section>
  );
}
