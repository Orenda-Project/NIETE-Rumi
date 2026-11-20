import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy, useLang } from "../../teacher/i18n";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { getCoachReport, type CoachReport } from "../report/api";
import { COACH_REPORT, type CoachReportCopy } from "../report/copy";
import { debriefPercent, starsOf } from "../report/CoachReportPage";
import { FLOW_V7, type FlowV7Copy } from "./copyV7";
import { debriefDueDay } from "./debriefDue";
import { karachiDay } from "../time";
import { OBSERVE } from "../observe/copy";

/**
 * bd-o15qnr.28 (queue #204, v7) — the visit's own step cards (#188's LOCK round: "Actions live on the visit only"):
 *
 *   DebriefDue      "Due by Mon 23 Nov" (3 school days after the visit), "Was due …" once past
 *   DebriefStage    Your debrief: talk with the teacher, then record it here: Start recording / Upload recording (the
 *                   Debrief screen, its guide on screen; ?upload=1 opens the file picker side)
 *   FeedbackCard    the report's own top card (%, the 5 stars, the teacher line) as ONE tap target to the one feedback
 *                   page; no sentence, no button
 *   SendStage       Send {name} the report: "{name} gets it on WhatsApp." and Send report
 */

const BIG = "flex min-h-[56px] flex-1 items-center justify-center gap-2.5 rounded-2xl px-4 text-[16px] font-semibold leading-tight rtl:leading-[1.8]";

function dayWords(day: string, lang: "en" | "ur"): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(/,/g, "");
}

export function DebriefDue({ visitDay }: { visitDay: string | null }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const lang = useLang();
  if (!visitDay) return null;
  const due = debriefDueDay(visitDay);
  const late = karachiDay() > due;
  return (
    <p data-testid="debrief-due" data-late={late ? "yes" : "no"}
      className={cn("m-0 -mt-1 px-0.5 text-[14px] font-semibold", late ? "text-[#b45309]" : "text-[#4b5563]")}>
      {late ? W.wasDue(dayWords(due, lang)) : W.dueBy(dayWords(due, lang))}
    </p>
  );
}

export function DebriefStage({ to }: { to: string }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const upload = `${to}${to.includes("?") ? "&" : "?"}upload=1`;
  return (
    <section data-testid="stage-debrief" className={cn(LIST_CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold">{W.yourDebrief}</h2>
        <p className="m-0 text-[15px] text-[#4b5563]">{W.talkThenRecord}</p>
      </div>
      <div className="flex flex-col gap-2.5">
        <Link to={to} className={cn(BIG, "bg-[#33374a] text-white", FOCUS)}>
          <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full bg-[#ff4d3d] shadow-[0_0_0_3px_rgba(255,77,61,0.25)]" />
          <StartWord />
        </Link>
        <Link to={upload} className={cn(BIG, "border border-[#e5e7eb] bg-white text-[#33374a]", FOCUS)}>
          <Upload className="h-5 w-5 shrink-0" aria-hidden="true" /><UploadWord />
        </Link>
      </div>
    </section>
  );
}

// The Observe words for the two buttons (one vocabulary: observe/copy.ts).
function StartWord() { return <>{useCopy(OBSERVE).startRecording}</>; }
function UploadWord() { return <>{useCopy(OBSERVE).uploadRecording}</>; }

export function FeedbackCard({ id, to }: { id: string; to: string }) {
  const C = useCopy(COACH_REPORT) as CoachReportCopy;
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const [r, setR] = useState<CoachReport | null>(null);
  useEffect(() => {
    let live = true;
    getCoachReport(id).then((x) => { if (live) setR(x); }).catch(() => { /* the card still opens the page, which says why */ });
    return () => { live = false; };
  }, [id]);
  const pct = r ? debriefPercent(r.done, r.total) : null;
  const n = pct == null ? 0 : starsOf(pct);
  return (
    <Link to={to} className={cn("block rounded-[22px]", FOCUS)}>
      <section data-testid="visit-feedback" aria-label={C.eyebrow}
        className="flex items-center gap-3 rounded-[22px] bg-[#33374a] px-[18px] py-4 text-white">
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[12px] font-bold uppercase tracking-[.08em] text-[#a9e3c4] rtl:normal-case rtl:tracking-normal rtl:text-[13px]">{C.eyebrow}</span>
          <span className="flex items-baseline gap-2">
            <b dir="ltr" className="text-[34px] font-extrabold leading-none">{pct == null ? "—" : `${pct}%`}</b>
            <span className="text-[14px] font-semibold text-[#c6e9d5]">{W.behavioursSeen}</span>
          </span>
          <span aria-hidden="true" className="flex gap-0.5 text-[16px] leading-none">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={i + 1 <= n ? "text-white" : i + 0.5 === n ? "text-white/60" : "text-white/25"}>★</span>
            ))}
          </span>
          {r?.header.teacher ? <span dir="auto" className="text-[13px] text-[#e2e5ea]">{r.header.teacher}</span> : null}
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-white/70 rtl:rotate-180" aria-hidden="true" />
      </section>
    </Link>
  );
}

export function SendStage({ name, to }: { name: string; to: string }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  return (
    <section data-testid="stage-send" className={cn(LIST_CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[18px] font-semibold">{W.sendTitle(name)}</h2>
        <p className="m-0 text-[15px] text-[#4b5563]">{W.getsOnWhatsApp(name)}</p>
      </div>
      <Link to={to} className={cn(BIG, "bg-[#33374a] text-white", FOCUS)}>{W.sendReport}</Link>
    </section>
  );
}

export function FormStage({ to }: { to: string }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  return (
    <Link to={to} data-testid="stage-form" className={cn(BIG, "w-full bg-[#33374a] text-white", FOCUS)}>
      {W.fillTheForm}<ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

/** bd-o15qnr.28 (v7, board m9-analysing) — while the Digital Coach listens: one plain card; the page asks again by itself. */
export function AnalysingStage() {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  return (
    <section data-testid="stage-analysing" className={cn(LIST_CARD, "flex items-start gap-3 p-4")}>
      <span aria-hidden="true" className="mt-1 flex h-3 w-3 shrink-0 rounded-full bg-[#f59e0b] motion-safe:animate-pulse" />
      <span className="flex min-w-0 flex-col gap-1">
        <b className="text-[17px] font-semibold">{W.listening}</b>
        <span className="text-[15px] text-[#4b5563]">{W.listeningSub}</span>
      </span>
    </section>
  );
}

/**
 * bd-o15qnr.28 (v7, board m9-errors: "Same card on every screen: red edge, one plain line, one button that fixes it") — the
 * error card: a title, at most one plain line, and the button(s) that fix it (children).
 */
export function ErrorCard({ testId, title, line, children }: { testId: string; title: string; line?: string; children?: ReactNode }) {
  return (
    <section data-testid={testId} role="alert" className={cn(LIST_CARD, "flex flex-col gap-3 border-2 border-[#c8331f] p-4")}>
      <span className="flex flex-col gap-1">
        <b className="text-[16px] font-semibold text-[#1d2025]">{title}</b>
        {line && <span className="text-[15px] text-[#4b5563]">{line}</span>}
      </span>
      {children}
    </section>
  );
}

/** A stopped observation (board m9-errors). */
export function StoppedStage({ text, children }: { text: string; children?: ReactNode }) {
  return <ErrorCard testId="stage-stopped" title={text}>{children}</ErrorCard>;
}

const ERROR_BUTTON = "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold leading-tight rtl:leading-[1.8]";

/** A fixing button inside an ErrorCard: the app's dark button, or (`quiet`) the white one under it. */
export function ErrorAction({ onClick, quiet = false, children }: { onClick: () => void; quiet?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(ERROR_BUTTON, quiet ? "border border-[#e5e7eb] bg-white text-[#33374a]" : "bg-[#33374a] text-white", FOCUS)}>
      {children}
    </button>
  );
}
