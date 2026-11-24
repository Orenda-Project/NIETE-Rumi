import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { HistoryRow, StepBar, type ChipData, type HistoryGroup, type HistoryItem } from "../../teacher/ui";
import { useCopy, useLang } from "../../teacher/i18n";
import { shortDayLabel } from "../../teacher/format";
import { OBSERVE } from "../observe/copy";
import type { CoachReport } from "../types";
import { obs612Line } from "../../lib/obs612";
import { REPORTS, type ReportsCopy } from "./copy";
import { pkTime, stepIndex, type DayGroup } from "./data";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { STATUS_STEPS, StatusLine } from "../flow/StatusLine";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";

/**
 * bd-4404s7.5 — the Reports lists, on the kit's coach rows (HistoryRow lead="person": the round 48px avatar, the
 * time on the first line). Every report — portal or WhatsApp, waiting or sent — opens the one v2 observation page.
 */
export const reportHref = (r: Pick<CoachReport, "id">) => `/portal/coach/observation/${r.id}`;

/**
 * bd-o15qnr.45 (queue #240) — the stages Observe's In progress shows, the system's (nothing waits on her). On the switch
 * (`v7`) a row at one of them says so: Analysing, Sending report, Waiting for teacher.
 */
export const IN_PROGRESS_STAGES = ["analysing", "sending", "waiting_teacher"] as const;
type InProgressStage = (typeof IN_PROGRESS_STAGES)[number];
const isInProgress = (stage?: string): stage is InProgressStage => (IN_PROGRESS_STAGES as readonly string[]).includes(stage || "");

/** An FDE / FICO 6-12 visit's percentage from its result line ("62% · Developing" → "62%"); null without one. */
function fdePct(r: CoachReport): string | null {
  const m = /^(\d+(?:\.\d+)?)%/.exec((r.obs612 && r.obs612.result) || "");
  return m ? `${m[1]}%` : null;
}

/**
 * The chip on a row: the score once there is one, else where the report is. `v7` (the switch, bd-o15qnr.45): a row the
 * system is working on names its stage, and a sent FICO 6-12 visit shows its percentage here (its line no longer
 * carries the rubric and result).
 */
export function reportChip(r: CoachReport, C: ReportsCopy, v7 = false): ChipData {
  if (v7 && isInProgress(r.stage)) return { text: C.stageChip[r.stage], tone: "info" };
  if (v7 && r.step === "sent" && r.score == null && fdePct(r)) return { text: fdePct(r) as string, tone: "score" };
  if (r.step === "sent" && r.score != null) return { text: C.pct(r.score), tone: "score" };
  const text = C.chip[r.step] ?? C.chip.analysing;
  // bd-f5a245 — a stopped analysis is the error tone (red): it needs her, and nothing is working on it.
  if (r.step === "stopped") return { text, tone: "error" };
  return { text, tone: r.step === "analysing" || r.step === "sent" ? "info" : "waiting" };
}

/**
 * bd-o15qnr.45 (the operator 23 Nov ~23:20 and ~23:22: "No need for fico 6-12 in there") — the class an observation
 * names, in her language: "Grade 7", "English" («جماعت 7», «انگریزی»). A grade or subject the visit did not name is left
 * out, never a dash; a subject key the app has no word for is left out too.
 */
export type ClassWords = { grade: (g?: number) => string; subjects: Record<string, string> };
export function classParts(c: { grade?: number | null; subject?: string | null }, O: ClassWords): string[] {
  const g = typeof c.grade === "number" && c.grade >= 1 && c.grade <= 12 ? O.grade(c.grade) : null;
  const s = c.subject ? O.subjects[c.subject] ?? null : null;
  return [g, s].filter((x): x is string => !!x);
}

/** The card's one line: the date, the grade, the subject ("Mon 23 Nov · Grade 7 · English"). */
export type CardLine = (r: { createdAt: string | null; grade?: number | null; subject?: string | null }) => string;

export function useCardLine(): CardLine {
  const lang = useLang();
  const O = useCopy(OBSERVE) as unknown as ClassWords;
  return useCallback<CardLine>((r) => {
    const t = r.createdAt ? Date.parse(r.createdAt) : NaN;
    const day = Number.isFinite(t) ? shortDayLabel(new Date(t), lang === "ur" ? "ur" : "en") : null;
    return [day, ...classParts(r, O)].filter(Boolean).join(" · ");
  }, [lang, O]);
}

/** On the switch: the card's line (`line`) and the stage chips (`v7`). Absent: every row as before. */
export type ReportRowOpts = { v7: boolean; line: CardLine };

/** One report as a HistoryRow's props (the school on line 2, the time above the name). */
export function reportItem(
  r: CoachReport, C: ReportsCopy, href: (r: Pick<CoachReport, "id">) => string = reportHref, opts?: ReportRowOpts,
): HistoryItem {
  return {
    id: r.id,
    lead: "person",
    title: r.teacherName || C.dash,
    // bd-pni007 — an FDE visit: its tool, result and label 'FDE v1' on the second line (it has no FICO score).
    // bd-o15qnr.45 — on the switch: the date, grade and subject only (no school, no rubric).
    extra: (opts ? opts.line(r) : [r.schoolName, r.obs612 ? obs612Line(r.obs612) : null].filter(Boolean).join(" · ")) || undefined,
    time: pkTime(r.createdAt),
    chip: reportChip(r, C, !!opts?.v7),
    to: href(r),
  };
}

/** The day groups HistoryList takes: `dayName` is the screen's words ("Today", "Mon 5 Oct"). */
export function reportGroups(
  groups: DayGroup[], dayName: (day: string) => string, C: ReportsCopy, href: (r: Pick<CoachReport, "id">) => string = reportHref,
  opts?: ReportRowOpts,
): HistoryGroup[] {
  return groups.map((g) => ({ day: dayName(g.day), items: g.items.map((r) => reportItem(r, C, href, opts)) }));
}

/** The four labelled segments under a waiting / in-progress card: the kit's StepBar, filled through the current stage. */
export function ReportSegments({ step, listening = false }: { step: string; listening?: boolean }) {
  const C = useCopy(REPORTS);
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const current = Math.min(stepIndex(step) + 1, C.segments.length);
  // bd-o15qnr.28 (v7, the v6/v7 switch): the status line, option A, on every list card too (#188's LOCK round).
  const v7 = useFlowV6() === true;
  if (v7) {
    const at = step === "sent" ? STATUS_STEPS : Math.max(0, stepIndex(step));
    return <div className="px-3.5 pb-3 pt-1" data-testid="report-segments"><StatusLine at={at} current={listening && step === "talk" ? W.debriefAnalysing : undefined} /></div>;
  }
  return (
    <div className="px-2.5 pb-3 pt-1" data-testid="report-segments">
      <StepBar total={C.segments.length} current={current} labels={C.segments} />
    </div>
  );
}

/**
 * bd-o15qnr.45 — what is hers next, in words ("Fill the form", "Record the debrief", "Send the report"); while the Digital
 * Coach listens to her debrief, that instead ("Debrief: analysing"). Null when nothing is hers (analysing, sent …).
 */
export function nextWords(r: Pick<CoachReport, "step" | "listening">, C: ReportsCopy, W: FlowV7Copy): string | null {
  if (r.step === "talk" && r.listening) return W.debriefAnalysing;
  // bd-f5a245 — the analysis stopped: upload the lesson again (the vocabulary's "Upload recording").
  if (r.step === "stopped") return C.nextLine(C.uploadRecording);
  const at = r.step === "draft" ? 1 : r.step === "talk" ? 2 : r.step === "report" ? 3 : -1;
  return at < 0 ? null : C.nextLine(W.steps[at].current);
}

/**
 * One report that needs her, or is being analysed: the row and its segments in one card (amber edge when it waits on her).
 * bd-o15qnr.45 (switch on; the operator 23 Nov ~23:20): no four-step bar — the row (date, grade, subject; the step chip)
 * and, when it waits on her, one line with the next step ("Next: Record the debrief").
 */
export function ReportCard({ r, waiting = false }: { r: CoachReport; waiting?: boolean }) {
  const C = useCopy(REPORTS);
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const flow = useFlowV6();
  const line = useCardLine();
  const v7 = flow === true;
  const { id, ...row } = reportItem(r, C, reportHref, v7 ? { v7, line } : undefined);
  const next = v7 && waiting ? nextWords(r, C, W) : null;
  return (
    <section data-testid="report-card" data-report={id}
      className={cn("overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]", waiting ? "border-2 border-[#f59e0b]" : "border border-[#e5e7eb]")}>
      <HistoryRow {...row} first />
      {/* off, and while the switch is read: the segments, as before */}
      {!v7 && <ReportSegments step={r.step} listening={!!r.listening} />}
      {next && <p data-testid="report-next" className="m-0 px-4 pb-3.5 text-[15px] font-semibold text-[#1d2025]">{next}</p>}
    </section>
  );
}
