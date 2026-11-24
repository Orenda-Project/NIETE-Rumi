import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronRight, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy, useLang } from "../../teacher/i18n";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { getCoachReport, type CoachReport } from "../report/api";
import { COACH_REPORT, type CoachReportCopy } from "../report/copy";
import { debriefPercent } from "../report/CoachReportPage";
import { FLOW_V7, type FlowV7Copy } from "./copyV7";
import { FORM_V7, type FormV7Copy } from "./copyV7form";
import { debriefDueDay } from "./debriefDue";
import { karachiDay } from "../time";
import { OBSERVE } from "../observe/copy";
import { REPORTS } from "../reports/copy";

/**
 * bd-o15qnr.28 (queue #204, v7) — the visit's own step cards (#188's LOCK round: "Actions live on the visit only"):
 *
 *   DebriefDue      "Due by Mon 23 Nov" (3 school days after the visit), "Was due …" once past
 *   DebriefStage    Next: Take the debrief: read the guide, talk with the teacher, then record it; ONE button, Take
 *                   debrief, opens the Debrief screen (the notes), where Record debrief floats at the bottom (DebriefDock)
 *   FeedbackCard    the report's own top card (%, the 5 stars, the teacher line) as ONE tap target to the one feedback
 *                   page; no sentence, no button
 *   SendStage       Send {name} the report: "{name} gets it on WhatsApp." and Send report
 *
 * bd-o15qnr.47 (queue #243, the operator 23 Nov ~23:23: the filled form "is just there on this page as a whole. Pushes
 * the next stuff all the way down") — the step she does next is the FIRST card under the header, "Next: <step>"
 * (NextCard, the form's own "Next:" words) with its button(s); every step she has done folds to one row (DoneRow):
 * what happened, one line, and what opens it (View form / View debrief / View report).
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
      className={cn("m-0 text-[14px] font-semibold", late ? "text-[#b45309]" : "text-[#4b5563]")}>
      {late ? W.wasDue(dayWords(due, lang)) : W.dueBy(dayWords(due, lang))}
    </p>
  );
}

/**
 * bd-o15qnr.47 — the visit's next step, first under the header: "Next: <step>" and what does it (children). An amber
 * start edge: the step waiting on her.
 */
export function NextCard({ step, children }: { step: string; children: ReactNode }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <section data-testid="visit-next" className={cn(LIST_CARD, "flex flex-col gap-3 border-s-4 border-s-[#f59e0b] p-4")}>
      <h2 className="m-0 text-[18px] font-semibold leading-[1.3] rtl:leading-[1.8]">{F.nextStep(step)}</h2>
      {children}
    </section>
  );
}

/**
 * The debrief, next: its due day, "Read the guide, talk with the teacher, then record it." and ONE button, Take debrief,
 * that opens the debrief notes (the Debrief page). bd-o15qnr.49 (queue #254; the operator 24 Nov ~11:00: "the debrief
 * record button is appearing, even though when you click the record button it actually takes you to the debrief notes")
 * — no Start recording / Upload recording here: both opened the notes anyway; recording starts there, from the notes
 * page's floating Record debrief (DebriefDock).
 */
export function DebriefStage({ to, due }: { to: string; due?: ReactNode }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  return (
    <NextCard step={W.steps[2].current}>
      <div data-testid="stage-debrief" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {due}
          <p className="m-0 text-[15px] text-[#4b5563]">{W.talkThenRecord}</p>
        </div>
        <Link to={to} className={cn(BIG, "w-full bg-[#33374a] text-white", FOCUS)}>
          {W.takeDebrief}<ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
    </NextCard>
  );
}

/**
 * bd-o15qnr.49 (queue #254; the operator 24 Nov ~11:00: "Maybe the record button should be a floating button at the bottom
 * of the page all the time, so they can read the notes and then they know that here is where they will start recording")
 * — the debrief notes page's Record debrief (and Upload recording), for the page frame's dock: pinned to the bottom of the
 * screen while she reads, above the menu and the phone's safe area (TeacherPage's sticky dock: in flow, so the last note
 * scrolls clear of it). Record is the dark button with the red recording dot; Upload sits beside it.
 */
export function DebriefDock({ onRecord, onUpload }: { onRecord: () => void; onUpload: () => void }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  return (
    <div data-testid="debrief-dock" className="flex w-full gap-2.5">
      <button type="button" onClick={onRecord} className={cn(BIG, "flex-[3] bg-[#33374a] text-white shadow-[0_4px_12px_rgba(16,24,40,0.18)]", FOCUS)}>
        <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full bg-[#ff4d3d] shadow-[0_0_0_3px_rgba(255,77,61,0.25)]" />
        {W.recordDebrief}
      </button>
      <button type="button" onClick={onUpload} className={cn(BIG, "flex-[2] border border-[#e5e7eb] bg-white text-[#33374a]", FOCUS)}>
        <Upload className="h-5 w-5 shrink-0" aria-hidden="true" /><UploadWord />
      </button>
    </div>
  );
}

// The Observe word for Upload recording (one vocabulary: observe/copy.ts).
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
    <NextCard step={W.sendTitle(name)}>
      <div data-testid="stage-send" className="flex flex-col gap-3">
        <p className="m-0 text-[15px] text-[#4b5563]">{W.getsOnWhatsApp(name)}</p>
        <Link to={to} className={cn(BIG, "bg-[#33374a] text-white", FOCUS)}>{W.sendReport}</Link>
      </div>
    </NextCard>
  );
}

export function FormStage({ to }: { to: string }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  return (
    <NextCard step={W.steps[1].current}>
      <Link to={to} data-testid="stage-form" className={cn(BIG, "w-full bg-[#33374a] text-white", FOCUS)}>
        {W.fillTheForm}<ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
      </Link>
    </NextCard>
  );
}

/* ── bd-o15qnr.47: a step she has done, folded to one row ─────────────────────────────────────────────────────── */

const VIEW = "flex min-h-[56px] shrink-0 items-center gap-1 rounded-xl border border-[#e5e7eb] bg-white px-3 text-[15px] font-semibold text-[#33374a] rtl:leading-[1.8]";

/**
 * One done step: a green tick (or `lead`), what happened (`title`), one line (`line`: a result such as "52 / 88 · 59.1%
 * · Developing", drawn left to right when `ltr`), and `action` (ViewLink / ViewToggle). `children` is what the row opens in
 * place. `item` names it in the visit's list (data-item, newest first).
 */
export function DoneRow({ testId, item, title, line, ltr = false, lead, action, children }: {
  testId: string; item: string; title: string; line?: string | null; ltr?: boolean; lead?: ReactNode; action?: ReactNode; children?: ReactNode;
}) {
  return (
    <section data-testid={testId} data-item={item} className={cn(LIST_CARD, "flex flex-col")}>
      <div className="flex min-h-[72px] items-center gap-3 p-3">
        {lead ?? <CheckCircle2 className="h-6 w-6 shrink-0 text-[#2f7a52]" aria-hidden="true" />}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]">{title}</b>
          {line ? (
            <span data-testid={`${testId}-result`} dir={ltr ? "ltr" : "auto"}
              className="self-start text-[14px] font-semibold leading-[1.35] text-[#4b5563] tabular-nums [overflow-wrap:anywhere]">{line}</span>
          ) : null}
        </span>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "View …" that opens a page. */
export function ViewLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className={cn(VIEW, FOCUS)}>
      {label}<ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

/** "View …" / "Hide …" that opens the row in place (aria-expanded). */
export function ViewToggle({ open, onToggle, view, hide }: { open: boolean; onToggle: () => void; view: string; hide: string }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className={cn(VIEW, FOCUS)}>
      {open ? hide : view}<ChevronDown className={cn("h-4 w-4", open && "rotate-180")} aria-hidden="true" />
    </button>
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
 * bd-o15qnr.39 (queue #204, the operator 22 Nov ~00:40: "I couldn't tell if my audio got submitted and is being
 * analyzed") — her debrief is in and the Digital Coach is listening: one plain card, how long it takes, and that she can
 * leave (the visit page asks again by itself). On the visit and on the Debrief page after the upload.
 */
export function DebriefListeningStage({ minutes = DEBRIEF_MINUTES, children }: { minutes?: number; children?: ReactNode }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  return (
    <section data-testid="stage-debrief-listening" role="status" className={cn(LIST_CARD, "flex flex-col gap-3 p-4")}>
      <span className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-1.5 flex h-3 w-3 shrink-0 rounded-full bg-[#f59e0b] motion-safe:animate-pulse" />
        <span className="flex min-w-0 flex-col gap-1">
          <b className="text-[17px] font-semibold">{W.listeningDebrief}</b>
          <span className="text-[15px] text-[#4b5563]">{W.aboutMinutes(minutes)}</span>
        </span>
      </span>
      {children}
    </section>
  );
}

/** How long the Digital Coach usually takes with a debrief (Debrief.tsx: "about 3 minutes"). */
export const DEBRIEF_MINUTES = 3;

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

/** A stopped observation (board m9-errors); `line` says why, when the visit knows (bd-k8uh1r: a recording already used). */
export function StoppedStage({ text, line, children }: { text: string; line?: string; children?: ReactNode }) {
  return <ErrorCard testId="stage-stopped" title={text} line={line}>{children}</ErrorCard>;
}

const ERROR_BUTTON = "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold leading-tight rtl:leading-[1.8]";

/** bd-f5a245 — a fixing button inside an ErrorCard that opens a page: ErrorAction's dark button, as a link. */
export function ErrorLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className={cn(ERROR_BUTTON, "bg-[#33374a] text-white", FOCUS)}>{children}</Link>;
}

/**
 * bd-f5a245 (queue #245) — the analysis stopped (it failed, or the system gave up on it): "Analysis stopped", why in one
 * plain line, and ONE button, Upload recording (`to`: the coach's Schedule an observation with that teacher picked; the
 * principal's, that teacher's page). On the observation page (`stage-stopped`) and the visit page.
 */
export function AnalysisStoppedCard({ testId = "stage-stopped", to }: { testId?: string; to: string | null }) {
  const C = useCopy(REPORTS);
  return (
    <ErrorCard testId={testId} title={C.chip.stopped} line={C.analysisStoppedLine}>
      {to && <ErrorLink to={to}><Upload className="h-5 w-5 shrink-0" aria-hidden="true" />{C.uploadRecording}</ErrorLink>}
    </ErrorCard>
  );
}

/** A fixing button inside an ErrorCard: the app's dark button, or (`quiet`) the white one under it. */
export function ErrorAction({ onClick, quiet = false, children }: { onClick: () => void; quiet?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(ERROR_BUTTON, quiet ? "border border-[#e5e7eb] bg-white text-[#33374a]" : "bg-[#33374a] text-white", FOCUS)}>
      {children}
    </button>
  );
}
