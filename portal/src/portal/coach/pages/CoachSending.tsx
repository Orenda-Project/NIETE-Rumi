import { Link, Navigate, useParams } from "react-router-dom";
import { AlertTriangle, Check, RotateCcw, Upload } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { NOTICES } from "../../teacher/notices/copy";
import { LeaveNote } from "../../teacher/ui";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { OBSERVE } from "../observe/copy";
import { failureWords, lengthShort } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import { retrySend, useSendJob } from "../observe/sender";

/**
 * bd-4404s7.4 — the observation being sent (Blueprint: Coach_Sending): a ring that fills as the files go up, "Sending",
 * the length and the teacher, and the operator's line for every waiting screen, "You can leave. We'll tell you here.",
 * with "The observation keeps sending in the background." under it. The menu stays: she can go anywhere, and the strip
 * above the menu follows the upload (teacher/notices). Go to Reports is the way out.
 *
 * It shows the job the SENDER holds, so it stays true when the notices have let go of the item (they are quiet on this
 * page). When the upload ends while she is here the page says so: sent → Open observation; failed → "Couldn't send",
 * the real reason and Try again (in the app only; nothing goes to WhatsApp). Nothing being sent for this visit → its page.
 */
const CoachSending = () => {
  const C = useCopy(OBSERVE);
  const L = useCopy(NOTICES);
  const { id = "" } = useParams();
  const job = useSendJob(id);
  if (!job) return <Navigate to={`/portal/coach/visit/${id}`} replace />;

  const failed = job.state === "failed";
  const sent = job.state === "sent";
  const hue = failed ? "#c8331f" : "#2f7a52";
  const length = lengthShort(job.durationMs, C);
  const caption = failed ? C.couldntSend : sent ? C.sent : C.sending;

  return (
    <ObservePage banner={false} title={C.observationOf(job.teacherName)} crumb={C.checkAndSend} backTo={`/portal/coach/visit/${id}`} feature="observations"
      dock={sent ? (
        <Link to={`/portal/coach/observation/${job.observationId}`}
          className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.openObservation}</Link>
      ) : failed ? (
        <button type="button" onClick={() => retrySend(id)}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white">
          <RotateCcw className="h-5 w-5" aria-hidden="true" />{C.tryAgain}
        </button>
      ) : (
        <Link to="/portal/coach/reports"
          className="flex h-14 flex-1 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025]">{C.goToReports}</Link>
      )}>
      <div className="flex flex-col items-center gap-[22px] pt-6">
        <div role="progressbar" aria-label={caption} aria-valuenow={job.pct} aria-valuemin={0} aria-valuemax={100}
          className="flex h-[220px] w-[220px] items-center justify-center rounded-full"
          style={{ background: `conic-gradient(${hue} 0 ${failed ? 0 : job.pct}%, ${failed ? "#fee4e2" : "#e5e7eb"} ${failed ? 0 : job.pct}% 100%)` }}>
          <span className="flex h-[188px] w-[188px] flex-col items-center justify-center gap-2 rounded-full bg-white">
            <i className="flex h-11 w-11 items-center justify-center rounded-full not-italic" style={{ background: failed ? "#fee4e2" : "#eaf6ef", color: hue }}>
              {failed ? <AlertTriangle className="h-6 w-6" aria-hidden="true" /> : sent ? <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" /> : <Upload className="h-6 w-6" aria-hidden="true" />}
            </i>
            {!failed && <b data-testid="send-pct" className="text-[48px] font-light leading-none tracking-[-0.02em] tabular-nums">{job.pct}%</b>}
          </span>
        </div>
        <p className="text-2xl font-semibold" data-testid="send-state">{caption}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {length && <StatusChip text={length} tone="info" />}
          <StatusChip text={job.teacherName} tone="info" />
        </div>
        {failed && (
          <p role="alert" className="w-full rounded-2xl bg-[#fef2f1] px-3.5 py-3 text-[15px] leading-snug text-[#7a271a]">{failureWords(job.errorCode, C)}</p>
        )}
        {!failed && !sent && <LeaveNote text={L.leave} sub={C.leaveSub} />}
      </div>
    </ObservePage>
  );
};

export default CoachSending;
