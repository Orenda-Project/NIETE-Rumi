import { useParams } from "react-router-dom";
import { Eye } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, IconCircle, Chip, Loading, Failed, useLoad } from "../ui";

/**
 * bd-o15qnr.10 — one HITL report, opened from a teacher's History. Read-only:
 * the date, the score, who observed, the summary, and the report image the
 * teacher received. The server serves it only while the teacher is in this
 * coach's patch and the report is out; anything else is a 404 → "Could not load".
 */
const day = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
  : C.dash);

const CoachObservation = () => {
  const { id = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getObservation(id), [id]);
  const backTo = data?.teacher?.teacherExtId ? `/portal/coach/teacher/${data.teacher.teacherExtId}` : "/portal/coach/people";

  return (
    <CoachPage title={data?.teacher?.name || C.observation} crumb={data ? `${C.observation} · ${day(data.date)}` : C.observation} backTo={backTo}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <Card className="flex flex-col gap-4 p-4" data-testid="observation-report">
          <div className="flex items-center gap-3">
            <IconCircle hue="observe" size={48}><Eye className="h-6 w-6" aria-hidden="true" /></IconCircle>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{C.hitl} · {day(data.date)}</div>
              <div className="truncate text-[13px] text-[#6b7280]">
                {C.observedBy} {data.observer.self ? C.you : (data.observer.name || C.dash)}
              </div>
            </div>
            <span className="text-[28px] font-light tabular-nums">{C.pct(data.score)}</span>
          </div>
          {data.sentAt && <div className="flex"><Chip tone="done">{C.reportSent} · {day(data.sentAt)}</Chip></div>}
          {data.imageUrl && (
            <img src={data.imageUrl} alt={`${C.observation} · ${data.teacher.name}`}
              className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb]" loading="lazy" />
          )}
          {data.summary && (
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-[#6b7280]">{C.summary}</span>
              <p className="whitespace-pre-line text-[15px] leading-relaxed" dir="auto">{data.summary}</p>
            </div>
          )}
        </Card>
      )}
    </CoachPage>
  );
};

export default CoachObservation;
