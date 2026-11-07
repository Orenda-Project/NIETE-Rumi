import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FeatureArt } from "../../teacher/icons/FeatureArt";
import { FOCUS } from "../../teacher/ui/styles";
import { useCopy, useLang, type Lang } from "../../teacher/i18n";
import { portal } from "../../services/api";
import { COACH_REPORT, type CoachReportCopy } from "./copy";
import { coachReportPath, coachWeekPath, getReadyReports, markSeen, markWeek, type ReadyDebrief, type ReadyReport } from "./api";
import { weekSpan } from "./weekSpan";

/**
 * Coach reports in the app — the card above the tiles on her Home when a report is ready. The teacher Home's "Next for
 * you" card (home/NextCard.tsx), drawn the same: white, radius 20, the first thing under the band and climbing into it,
 * the eyebrow row with the feature art in a pale disc, the title, one sub line (teacher · class · time — never a score),
 * and a 48px navy Open. Two waiting reports share one card, newest first. ✕ closes it: that counts as seen, so no
 * WhatsApp link follows (the teacher app's rule).
 *
 * The Home re-reads every 30 s while it is on screen (and at once when it comes back to the front), so a report that
 * lands while she is looking appears without a reload. Behind app_settings.coach_reports_app (/config
 * features.coachReportsApp, a literal true only): off, unread or failed, nothing is drawn and nothing is asked.
 */
const POLL_MS = 30_000;

export function useCoachReportsApp(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => portal.getConfig())
      .then((cfg) => { if (live) setOn(cfg?.features?.coachReportsApp === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

export function useReadyReports(on: boolean | null): { reports: ReadyReport[]; dismiss: (shown: ReadyReport[]) => void } {
  const [reports, setReports] = useState<ReadyReport[]>([]);
  useEffect(() => {
    if (on !== true) return undefined;
    let live = true;
    const read = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      getReadyReports().then((r) => { if (live) setReports(r); }).catch(() => { /* a failed read keeps what is shown */ });
    };
    read();
    const every = setInterval(read, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; clearInterval(every); document.removeEventListener("visibilitychange", onVisible); };
  }, [on]);
  const dismiss = useCallback((shown: ReadyReport[]) => {
    const ids = shown.map((r) => r.id);
    setReports((now) => now.filter((r) => !ids.includes(r.id)));
    shown.forEach((r) => { if (r.kind === "week") void markWeek(r.monday, "seen"); else void markSeen(r.id); });
  }, []);
  return { reports, dismiss };
}

/**
 * When the report was ready, in Pakistan time: the time alone today, the day and time before that (a report waits on the
 * card for up to 3 days, and "11:00 am" for one from two days ago read as today; bd-enec2e.5).
 */
const timeOf = (iso: string | null, lang: Lang) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const loc = lang === "ur" ? "ur-PK" : "en-GB";
  const tz = { timeZone: "Asia/Karachi" } as const;
  const dayOf = (x: Date) => new Intl.DateTimeFormat("en-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = new Intl.DateTimeFormat(loc, { ...tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  if (dayOf(d) === dayOf(new Date())) return time;
  return `${new Intl.DateTimeFormat(loc, { ...tz, day: "numeric", month: "short" }).format(d)}, ${time}`;
};

function subOf(r: ReadyDebrief, lang: Lang): string {
  const cls = [r.grade ? (lang === "ur" ? `جماعت ${r.grade}` : `Grade ${r.grade}`) : null, r.subject].filter(Boolean).join(" ");
  return [r.teacher, cls || null, timeOf(r.at, lang)].filter(Boolean).join(" · ");
}

/** The card itself, or nothing (switch off, nothing ready). Placed first under the band on both coach Homes. */
export function ReadyReportCard({ className }: { className?: string }) {
  const on = useCoachReportsApp();
  const { reports, dismiss } = useReadyReports(on);
  const C = useCopy(COACH_REPORT) as CoachReportCopy;
  const lang = useLang();
  const navigate = useNavigate();
  if (on !== true || reports.length === 0) return null;
  const shown = reports.slice(0, 2);
  const dir = lang === "ur" ? "rtl" : undefined;
  return (
    <section data-testid="coach-report-card" aria-label={C.readyEyebrow}
      className={cn("relative rounded-[20px] border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.08)] first:-mt-10", className)}>
      <div className="flex min-h-[28px] items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ecfccb]" aria-hidden="true">
          <FeatureArt feature="reports" size={26} />
        </span>
        <p dir={dir} className="flex-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6b7280] rtl:normal-case rtl:tracking-normal rtl:text-[13px]">{C.readyEyebrow}</p>
        <button type="button" data-testid="coach-report-card-close" aria-label={C.close} onClick={() => dismiss(shown)}
          className={cn("-me-2 flex h-11 w-11 items-center justify-center rounded-full text-[#6b7280]", FOCUS)}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {shown.map((r, i) => (
        <div key={r.id} data-testid="coach-report-card-row" className={cn("flex flex-col gap-1", i > 0 ? "mt-3 border-t border-[#f0f1f3] pt-3" : "mt-2")}>
          <h2 dir={dir} className="line-clamp-2 text-[18px] font-semibold leading-snug text-[#111827] rtl:text-[17px]">
            {r.kind === "week" ? C.readyWeek(weekSpan(r.monday, r.friday, lang)) : C.readyDebrief}
          </h2>
          <p dir="auto" className="truncate text-[13px] text-[#4b5563]">{r.kind === "week" ? C.weekDebriefs(r.debriefs) : subOf(r, lang)}</p>
          <button type="button" data-primary="" onClick={() => navigate(r.kind === "week" ? coachWeekPath(r.monday) : coachReportPath(r.id))}
            className={cn("mt-2 flex min-h-[48px] items-center justify-center rounded-2xl bg-[#333748] px-3 text-center text-[16px] font-semibold leading-tight text-white", FOCUS)}>
            {r.kind === "week" ? C.openWeek : C.open}
          </button>
        </div>
      ))}
    </section>
  );
}
