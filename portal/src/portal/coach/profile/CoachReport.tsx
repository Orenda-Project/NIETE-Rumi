import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CircleCheck, Hash, Lightbulb, MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach } from "../../services/api";
import TeacherPage from "../../teacher/TeacherPage";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy } from "../../teacher/i18n";
import { ChosenSoFar } from "../../teacher/ui";
import { FOCUS } from "../../teacher/ui/styles";
import CoachGate from "../CoachGate";
import { BottomButton } from "../ui";
import { COACH_PROFILE } from "./copy";

/**
 * bd-whlsm0 — More → Report an issue (operator, 30 Oct: "add a form they can fill on the issues ... collect that
 * feedback"). The form pattern: one question per screen. First the kind of issue, four big buttons; then what she chose
 * (with Change) and her message, and Send. Sent: a thank-you and the way back to More. Not sent: her words stay and
 * the button says Try again. Stored for her on the server (POST /coach/feedback → coach_feedback).
 */
type Kind = "broken" | "numbers" | "idea" | "other";
const KINDS: readonly { kind: Kind; icon: LucideIcon }[] = [
  { kind: "broken", icon: AlertTriangle },
  { kind: "numbers", icon: Hash },
  { kind: "idea", icon: Lightbulb },
  { kind: "other", icon: MoreHorizontal },
];
const MAX = 2000;
const TILE = "flex min-h-[64px] w-full items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-start text-[17px] font-semibold text-[#1d2025] shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:bg-[#f9fafb]";
const AREA = "w-full rounded-xl border border-[#d1d5db] bg-white p-3 text-[16px] leading-snug text-[#1d2025]";
const PROMPT = "m-0 text-[15px] font-semibold text-[#4b5563] rtl:leading-[1.8]";

export default function CoachReport() {
  const C = useCopy(COACH_PROFILE);
  const F = useCopy(TEACHER_FRAME);
  const [kind, setKind] = useState<Kind | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const areaId = useId();
  const words = message.trim();

  const send = async () => {
    if (!kind || !words || state === "sending") return;
    setState("sending");
    try {
      await coach.reportIssue({ kind, message: words });
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <CoachGate>
      <TeacherPage title={C.report} backTo="/portal/coach/more" testId="coach-report"
        dock={kind && state !== "sent"
          ? <BottomButton onClick={send} disabled={!words || state === "sending"}>{state === "failed" ? F.tryAgain : C.send}</BottomButton>
          : undefined}>
        {state === "sent" ? (
          <section data-testid="report-sent" role="status" className="flex flex-col items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-8 text-center">
            <CircleCheck className="h-12 w-12 text-[#2f7a52]" strokeWidth={2.2} aria-hidden="true" />
            <b className="text-[20px] font-bold">{C.sent}</b>
            <span className="text-[16px] text-[#4b5563]">{C.thanks}</span>
            <Link to="/portal/coach/more" className={cn("mt-3 flex h-14 w-full items-center justify-center rounded-2xl bg-[#2f7a52] text-base font-semibold text-white", FOCUS)}>{F.more.title}</Link>
          </section>
        ) : !kind ? (
          <section className="flex flex-col gap-2.5">
            <h2 className={PROMPT}>{C.reportKind}</h2>
            {KINDS.map(({ kind: k, icon: Icon }) => (
              <button key={k} type="button" data-testid="report-kind" onClick={() => setKind(k)} className={cn(TILE, FOCUS)}>
                <Icon className="h-[22px] w-[22px] shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" />
                <span>{C.kinds[k]}</span>
              </button>
            ))}
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            <div data-testid="report-chosen">
              <ChosenSoFar items={[{ label: C.reportKind, value: C.kinds[kind], onChange: () => { setKind(null); setState("idle"); } }]} />
            </div>
            <label htmlFor={areaId} className={PROMPT}>{C.reportMessage}</label>
            <textarea id={areaId} value={message} onChange={(e) => setMessage(e.target.value.slice(0, MAX))} rows={6} dir="auto"
              maxLength={MAX} className={cn(AREA, FOCUS)} />
            {state === "failed" && (
              <p data-testid="report-failed" role="alert" className="m-0 text-[15px] font-semibold text-[#c8331f]">{C.notSent}</p>
            )}
          </section>
        )}
      </TeacherPage>
    </CoachGate>
  );
}
