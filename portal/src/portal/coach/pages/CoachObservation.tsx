import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ChevronUp, MapPin, Pause, Play } from "lucide-react";
import { coach, leader } from "../../services/api";
import type { CoachObservationView, ObservationDraft } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, Chip, PageChip, Loading, Failed, useLoad } from "../ui";
import { FROM_COACH, trackerIndex } from "../../lib/coachObserve";
import { FeedbackCard } from "../../pages/LeaderObservation";
import { Guide } from "../../pages/LeaderObserveTalk";

/**
 * bd-o15qnr.19 — the one v2 observation page (v24 ObsTrack), opened from every
 * Reports card and every HITL row of a teacher's History.
 *
 * Header: the teacher, her school, the day. The Digital Coach score ring (the
 * draft's, before the coach's check; the final one once sent) and the lesson to
 * play. Then the five steps — Lesson analysed → Feedback Form → Debrief → Your
 * feedback → Send <name> the report — done green, current indigo, later grey.
 *
 * In progress, the current step says "Your turn" and is the dock action, which
 * opens where the coach does it (the existing form, debrief and observation
 * pages, told they came from v2). An observation captured on WhatsApp is shown
 * here too, but its steps happen on WhatsApp. Completed, every step is done and
 * each opens what it holds: the summary, the form's answers, the debrief guide,
 * the coach's feedback and the report the teacher received.
 *
 * The session row (/coach/observation/:id, any HITL of a teacher in her patch)
 * says where it stands; for her own observation the pipeline's view
 * (/leader/observe/:id) adds the finer steps and their content — captured in
 * the portal or on WhatsApp alike (bd-15y1pc). Only a portal one is acted on here.
 */

const WORKER_STEPS = new Set(["analysing", "listening", "sending"]);

/** The step index from the session row alone (no portal view): draft 1, debrief 2, report 4, sent → all done. */
function indexFromRow(step: string | undefined): number {
  return { analysing: 0, draft: 1, talk: 2, report: 4, sent: 5 }[step || "analysing"] ?? 0;
}

/** The steps that wait on the coach — on WhatsApp, for an observation captured there. */
const HER_STEPS = ["draft", "talk", "feedback", "report"];

const dateTime = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/,/g, "").replace(/(\d{1,2}:\d{2}) ?(am|pm)/i, (_m, t, ap) => `· ${t} ${String(ap).toUpperCase()}`)
  : C.dash);

function ScoreRing({ value }: { value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const text = C.pct(value);
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full" aria-label={C.dcScoreOf(text)} role="img"
      style={{ background: `conic-gradient(#33374a 0 ${pct}%, #e8e9f0 ${pct}% 100%)` }}>
      <span className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-white text-[15px] font-bold tabular-nums">{text}</span>
    </span>
  );
}

function FormAnswers({ draft }: { draft: ObservationDraft }) {
  const titleOf = (opts: { id: string; title: string }[], v: string | undefined) => (opts.find((o) => o.id === v) || { title: v || C.dash }).title;
  return (
    <div className="flex flex-col gap-3" data-testid="form-answers">
      {draft.sections.map((s) => (
        <div key={s.key} className="flex flex-col gap-2">
          <span className="text-[13px] font-bold uppercase tracking-wide text-[#6b7280]">{s.letter}. {s.title}</span>
          {s.kind === "indicators" ? s.indicators.map((i) => (
            <div key={i.id} className="flex flex-col gap-1 rounded-xl bg-[#f9fafb] p-3">
              <span className="flex items-start justify-between gap-2"><b className="text-[15px] font-semibold" dir="auto">{i.name}</b><Chip>{titleOf(draft.scale, i.rating)}</Chip></span>
              {i.evidence && <span className="text-[14px] text-[#374151]" dir="auto">{i.evidence}</span>}
              {i.improvement && <span className="text-[14px] text-[#6b7280]" dir="auto">{i.improvement}</span>}
            </div>
          )) : s.moves.map((m) => (
            <div key={m.k} className="flex flex-col gap-1 rounded-xl bg-[#f9fafb] p-3">
              <span className="flex items-start justify-between gap-2"><b className="text-[15px] font-semibold" dir="auto">{m.plan}</b><Chip>{titleOf(draft.fidelityScale, m.verdict)}</Chip></span>
              {m.evidence && <span className="text-[14px] text-[#374151]" dir="auto">{m.evidence}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type StepState = "done" | "now" | "todo";

function StepRow({ n, label, state, chip, content, last }: { n: number; label: string; state: StepState; chip?: ReactNode; content?: () => ReactNode; last: boolean }) {
  const [open, setOpen] = useState(false);
  const dot = state === "done"
    ? <span className="relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#48b078] bg-[#48b078] text-white"><Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" /></span>
    : state === "now"
      ? <span className="relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#33374a] bg-[#33374a] text-[15px] font-bold text-white shadow-[0_0_0_5px_#e8e9f0]">{n}</span>
      : <span className="relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#e5e7eb] bg-[#f3f4f6] text-[15px] font-bold text-[#9ca3af]">{n}</span>;
  const head = (
    <>
      {dot}
      <span className={`min-w-0 flex-1 text-base font-semibold ${state === "todo" ? "text-[#9ca3af]" : "text-[#1d2025]"}`} dir="auto">{label}</span>
      {chip}
      {state === "done" && !chip && <Chip tone="done">{C.done}</Chip>}
      {content && (open ? <ChevronUp className="h-5 w-5 shrink-0 text-[#9ca3af]" aria-hidden="true" /> : <ChevronDown className="h-5 w-5 shrink-0 text-[#9ca3af]" aria-hidden="true" />)}
    </>
  );
  const rowCls = `relative flex min-h-[72px] w-full items-center gap-3.5 py-2.5 pe-3.5 ps-4 text-left ${state === "now" ? "bg-[#f9fafb]" : ""}`;
  return (
    <li data-testid="obs-step" data-state={state} data-label={label} aria-current={state === "now" ? "step" : undefined} className="relative">
      {!last && !open && <span aria-hidden="true" className={`absolute start-[35px] top-[54px] z-0 h-[36px] w-0.5 ${state === "done" ? "bg-[#48b078]" : "bg-[#e5e7eb]"}`} />}
      {content
        ? <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={rowCls}>{head}</button>
        : <div className={rowCls}>{head}</div>}
      {content && open && <div className="px-4 pb-4 pt-1">{content()}</div>}
    </li>
  );
}

const CoachObservation = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, failed, reload } = useLoad(() => coach.getObservation(id), [id]);
  const [view, setView] = useState<CoachObservationView | null>(null);
  const [draft, setDraft] = useState<ObservationDraft | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const mine = !!data?.mine;
  const portalMine = !!(data?.portal && mine);

  // Her own observation: the pipeline's view knows the finer steps and their content,
  // whichever side it was captured on (bd-15y1pc).
  useEffect(() => {
    if (!mine) return undefined;
    let live = true;
    leader.getObservation(id).then((v) => { if (live) setView(v); }).catch(() => { /* the row's step is enough */ });
    return () => { live = false; };
  }, [mine, id]);

  useEffect(() => () => { player.current?.pause(); }, []);

  const draftAsked = useRef(false);
  const loadDraft = () => {
    if (draftAsked.current) return;
    draftAsked.current = true;
    leader.getObservationDraft(id).then(setDraft).catch(() => { draftAsked.current = false; });
  };

  const back = () => (location.key && location.key !== "default" ? navigate(-1) : navigate("/portal/coach/reports"));
  const name = data?.teacher?.name || view?.teacher?.name || C.dash;
  const first = name.split(/\s+/)[0] || name;
  const labels = C.trackSteps(first);
  const stopped = view?.step === "stopped";
  const at = view ? trackerIndex(view.step) : indexFromRow(data?.step);
  const allDone = at >= 5;
  const viewStep = view?.step;
  const herTurn = portalMine && !!view && HER_STEPS.includes(view.step) && !(view.step === "report" && view.preparing);
  const onWhatsApp = !portalMine && HER_STEPS.includes((view ? view.step : data?.step) || "");
  const working = (viewStep && WORKER_STEPS.has(viewStep)) || (viewStep === "report" && view?.preparing) || (!view && data?.step === "analysing");
  const dockHref = !herTurn ? null
    : at === 1 ? `/portal/leader/observe/${id}/draft?${FROM_COACH}`
      : at === 2 ? `/portal/leader/observe/${id}/talk?${FROM_COACH}`
        : `/portal/leader/observe/${id}?${FROM_COACH}`;
  const score = data ? (data.score ?? data.dcScore ?? null) : null;
  const reportImage = data?.imageUrl || view?.report.imageUrl || null;
  const reportCaption = data?.caption || view?.report.caption || null;

  const togglePlay = () => {
    if (!data?.audioUrl) return;
    try {
      if (!player.current) {
        player.current = new Audio(data.audioUrl);
        player.current.onended = () => setPlaying(false);
      }
      if (playing) { player.current.pause(); setPlaying(false); } else { void player.current.play(); setPlaying(true); }
    } catch { setPlaying(false); }
  };

  // What each done step holds, when there is something to show.
  const contentFor = (i: number): (() => ReactNode) | undefined => {
    if (i >= at && !allDone) return undefined;
    if (i === 0 && data?.summary) return () => <p className="whitespace-pre-line text-[15px] leading-relaxed" dir="auto">{data.summary}</p>;
    if (i === 1 && mine) return () => { loadDraft(); return draft ? <FormAnswers draft={draft} /> : <Loading />; };
    if (i === 2 && view?.talk.guide) return () => <Guide guide={view.talk.guide!} />;
    if (i === 3 && view?.talk.feedback) return () => <FeedbackCard fb={view.talk.feedback!} />;
    if (i === 4 && allDone && reportImage) {
      return () => (
        <div className="flex flex-col gap-2" data-testid="observation-report">
          <img src={reportImage} alt={C.reportOf(name)} className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb]" loading="lazy" />
          {reportCaption && <p className="whitespace-pre-line text-[14px] leading-relaxed" dir="auto">{reportCaption}</p>}
        </div>
      );
    }
    return undefined;
  };

  return (
    <CoachPage title={name} crumb={C.reports} onBack={back}
      chips={data ? (
        <>
          {data.teacher.schoolName && <PageChip><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{data.teacher.schoolName}</PageChip>}
          <PageChip>{dateTime(data.date)}</PageChip>
        </>
      ) : undefined}
      dock={dockHref ? (
        <Link to={dockHref} data-testid="obs-dock"
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white">
          {labels[at]}<ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      ) : undefined}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <Card className="flex items-center gap-3.5 px-4 py-3.5">
            <ScoreRing value={score} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[17px] font-semibold">{C.dcScore}</span>
              <span className="truncate text-[13px] text-[#6b7280]">{allDone ? `${C.reportSent} · ${dateTime(data.sentAt || data.date).split(" ·")[0]}` : C.draftBeforeCheck}</span>
            </span>
            {data.audioUrl && (
              <button type="button" onClick={togglePlay} aria-label={playing ? C.pauseLesson : C.playLesson}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#48b078] bg-white text-[#48b078]">
                {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5 fill-current" aria-hidden="true" />}
              </button>
            )}
          </Card>

          {stopped ? (
            <Card className="flex gap-2.5 bg-[#fef3c7] p-4 text-[15px] text-[#b45309]">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><span>{C.stopped}</span>
            </Card>
          ) : (
            <Card className="overflow-hidden py-1.5" aria-label={C.steps5}>
              <ol>
                {labels.map((label, i) => {
                  const state: StepState = allDone || i < at ? "done" : i === at ? "now" : "todo";
                  const chip = state !== "now" ? undefined
                    : onWhatsApp ? <Chip>{C.onWhatsApp}</Chip>
                      : herTurn ? <Chip tone="warn">{C.yourTurn}</Chip>
                        : working ? <Chip>{C.working}</Chip> : undefined;
                  return <StepRow key={label} n={i + 1} label={label} state={state} chip={chip} content={contentFor(i)} last={i === labels.length - 1} />;
                })}
              </ol>
            </Card>
          )}
          {onWhatsApp && <p className="px-1 text-[13px] text-[#6b7280]">{C.continueOnWhatsApp}</p>}
        </>
      )}
    </CoachPage>
  );
};

export default CoachObservation;
