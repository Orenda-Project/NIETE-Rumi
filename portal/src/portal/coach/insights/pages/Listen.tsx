import { useState } from "react";
import { useLang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { coachip } from "../api";
import { useLoad } from "../useLoad";
import { InsightsPage } from "../components/Frame";
import { NoteCard, StateBlock } from "../components/StateBlock";
import ListenRow from "../components/ListenRow";
import { CodeText, CountSpan, DateText, Num, WindowMark } from "../count";
import { range } from "../format";
import { pick, t, tx } from "../text";
import type { MomentsFeed } from "../types";

/**
 * bd-sex15q.15 — the Listen tab (G2; `/listen`, `GET /coachip/moments?w=`): this week's moments across the coach's
 * schools, newest first as the server sent them. The base line ("n of d graded recordings this week have a moment"),
 * the W filter chips with their own counts (a chip re-reads the feed with `?w=`), the rows (ListenRow; one inline
 * player at a time), and the sessions whose analysis failed (school and date, never a code; the full recording plays).
 * Empty: no graded recording this week, or no moment for the chosen W. The read sits inside the gate (B7).
 */
export default function Listen() {
  return (
    <InsightsGate>
      <ListenBody />
    </InsightsGate>
  );
}

function ListenBody() {
  const lang = useLang();
  const [w, setW] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const { data, error } = useLoad<MomentsFeed>(() => coachip.moments({ w }), [w]);
  const choose = (next: string | null) => { setPlaying(null); setW(next); };
  return (
    <InsightsPage testId="insights-listen" title={t("l.title", lang)} windows={data?.windows}>
      {!data ? <StateBlock error={error} /> : (
        <div className="flex flex-col gap-3">
          {/* the crumb: a top-level page has no crumb slot in TeacherPage, so the week line leads the body */}
          <p data-testid="listen-week" className="-mt-1 px-1 text-[13px] font-medium text-[#6b7280]">
            {tx("l.sub", lang, { week_range: <WindowMark window={data.window} as="span">{range(data.window.from, data.window.to, lang)}</WindowMark> })}
          </p>
          {/* fix-r5 s2 item 3 (B10, design-qa 073628 §1): a week with no graded recording has nothing to count, so no
              "0 of 0" base line and no "All 0 of 0" chip; the empty card speaks alone */}
          {data.base.d > 0 && (
            <>
              <p data-testid="listen-base" className="px-1 text-[14px] leading-snug text-[#374151]">
                {tx("l.base", lang, { grader_label: pick(data.window.grader_label, lang) }, [{ n: "n", d: "d", count: data.base }])}
              </p>
              <div role="group" className="flex flex-wrap gap-2">
                <Chip on={w === null} wId="" onClick={() => choose(null)} label={t("l.filter.all", lang)} count={<Num count={data.base} lang={lang} />} />
                {data.filters.map((f) => (
                  <Chip key={f.w_id} on={w === f.w_id} wId={f.w_id} onClick={() => choose(f.w_id)}
                    label={f.w_id === "good" ? t("l.filter.good", lang) : pick(f.short_name, lang)}
                    count={<Num count={f.count} lang={lang} />} />
                ))}
              </div>
            </>
          )}
          <Feed data={data} w={w} playing={playing} setPlaying={setPlaying} />
        </div>
      )}
    </InsightsPage>
  );
}

function Chip({ on, wId, label, count, onClick }: { on: boolean; wId: string; label: string; count: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" data-testid="listen-chip" data-w={wId} aria-pressed={on ? "true" : "false"} onClick={onClick}
      className={`flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold ${on
        ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#d1d5db] bg-white text-[#1d2025]"}`}>
      <span>{label}</span>
      <span className={on ? "text-[12px] font-medium text-white/80" : "text-[12px] font-medium text-[#6b7280]"}>{count}</span>
    </button>
  );
}

function Feed({ data, w, playing, setPlaying }: { data: MomentsFeed; w: string | null; playing: string | null; setPlaying: (id: string | null) => void }) {
  const lang = useLang();
  const failed = w === null ? data.failed_sessions : [];
  // fix-r5 s2 item 13 (design-qa 085041): the failed sessions are read BEFORE the empty return, so a week whose only
  // recording failed its analysis shows the card and, under it, that row with its full recording
  if (w === null && data.recordings.n === 0) {
    return (
      <>
        <NoteCard>
          <CountSpan count={data.recordings}><span data-testid="listen-empty-all">{t("l.empty.all", lang, { r: data.recordings.d })}</span></CountSpan>
        </NoteCard>
        {failed.length > 0 && <FailedList failed={failed} />}
      </>
    );
  }
  if (data.moments.length === 0 && failed.length === 0) {
    if (w === null) return null;
    const f = data.filters.find((x) => x.w_id === w);
    const name = w === "good" ? t("l.filter.good", lang) : pick(f?.short_name, lang);
    return <NoteCard testId="listen-empty-filter">{t("l.empty.filter", lang, { short_name: name })}</NoteCard>;
  }
  return (
    <ul className="flex flex-col divide-y divide-[#f3f4f6] overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
      {data.moments.map((m) => (
        <ListenRow key={m.moment_id} moment={m} playing={playing === m.moment_id}
          onPlay={() => setPlaying(playing === m.moment_id ? null : m.moment_id)} />
      ))}
      {failed.map((s) => <FailedRow key={s.session_id} s={s} />)}
    </ul>
  );
}

type Failed = MomentsFeed["failed_sessions"][number];

/** A session whose analysis failed: school and date, never a code; the full recording plays (API R8). */
function FailedRow({ s }: { s: Failed }) {
  const lang = useLang();
  return (
    <li data-testid="listen-failed-session" className="flex flex-col gap-1.5 px-3.5 py-3">
      <span className="text-[15.5px] font-semibold leading-snug text-[#1d2025] [overflow-wrap:anywhere]">
        <CodeText lang={lang}>{s.school.school_name}</CodeText>
      </span>
      <span className="text-[13px] leading-snug text-[#6b7280]">
        {tx("l.row.analysis_failed", lang, { date: <DateText iso={s.recorded_on} lang={lang} /> })}
      </span>
      <FullRecording sessionId={s.session_id} />
    </li>
  );
}

function FailedList({ failed }: { failed: Failed[] }) {
  return (
    <ul className="flex flex-col divide-y divide-[#f3f4f6] overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
      {failed.map((s) => <FailedRow key={s.session_id} s={s} />)}
    </ul>
  );
}

/** The whole recording of a session whose analysis failed: the coach-only audio route (API R8), on tap only. */
function FullRecording({ sessionId }: { sessionId: string }) {
  return (
    <div dir="ltr">
      <audio controls preload="none" src={`/api/portal/coachip/session/${encodeURIComponent(sessionId)}/audio`} className="w-full">
        <track kind="captions" />
      </audio>
    </div>
  );
}
