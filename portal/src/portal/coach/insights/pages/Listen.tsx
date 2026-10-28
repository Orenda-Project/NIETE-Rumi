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
import { Section } from "../../../coachip-ui/Section";

/**
 * bd-sex15q.15 — the Listen tab (G2; `/listen`, `GET /coachip/moments?w=`): this week's moments across the coach's
 * schools, newest first as the server sent them. The base line ("n of d graded recordings this week have a moment"),
 * the W filter chips with their own counts (a chip re-reads the feed with `?w=`), the rows (ListenRow; one inline
 * player at a time), and the sessions whose analysis failed (school and date, never a code; the full recording plays).
 * Empty: no graded recording this week, or no moment for the chosen W. The read sits inside the gate (B7).
 *
 * R6 (bd-sex15q.46, SCREENS.md Listen): a top-level tab, so the band, with the week line as its one line; the base
 * line 13 ink-3; the W filter as pills (on: green with a navy label; off: green tint); the moments as hairline rows;
 * the analysis-failed sessions their own grey section under them. Colour only through the coachip-ui tokens.
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
    <InsightsPage
      testId="insights-listen"
      title={t("l.title", lang)}
      windows={data?.windows}
      // the week line is the band's one line (R6); it waits for the payload, as before
      chips={data ? (
        <p data-testid="listen-week" className="text-[14px] leading-snug">
          {tx("l.sub", lang, { week_range: <WindowMark window={data.window} as="span">{range(data.window.from, data.window.to, lang)}</WindowMark> })}
        </p>
      ) : undefined}
    >
      {!data ? <StateBlock error={error} /> : (
        <div className="flex flex-col gap-4">
          {/* fix-r5 s2 item 3 (B10, design-qa 073628 §1): a week with no graded recording has nothing to count, so no
              "0 of 0" base line and no "All 0 of 0" chip; the empty card speaks alone */}
          {data.base.d > 0 && (
            <>
              <p data-testid="listen-base" className="text-[13px] leading-[1.45] text-cp-ink-3">
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
      className={`cp-press flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-cp-navy ${on
        ? "bg-cp-green text-cp-navy" : "bg-cp-green-tint text-cp-green-ink"}`}>
      <span>{label}</span>
      <span className="text-[12px] font-medium">{count}</span>
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
    <>
      {data.moments.length > 0 && (
        <ul className="flex flex-col border-y border-cp-hairline">
          {data.moments.map((m) => (
            <ListenRow key={m.moment_id} moment={m} playing={playing === m.moment_id}
              onPlay={() => setPlaying(playing === m.moment_id ? null : m.moment_id)} />
          ))}
        </ul>
      )}
      {failed.length > 0 && <FailedList failed={failed} />}
    </>
  );
}

type Failed = MomentsFeed["failed_sessions"][number];

/** A session whose analysis failed: school and date, never a code; the full recording plays (API R8). */
function FailedRow({ s }: { s: Failed }) {
  const lang = useLang();
  return (
    <li data-testid="listen-failed-session" className="flex flex-col gap-1.5 border-t border-cp-hairline px-4 py-3.5 first:border-t-0">
      <span className="text-[17px] font-semibold leading-[1.4] text-cp-ink [overflow-wrap:anywhere]">
        <CodeText lang={lang}>{s.school.school_name}</CodeText>
      </span>
      <span className="text-[13px] leading-[1.45] text-cp-ink-3">
        {tx("l.row.analysis_failed", lang, { date: <DateText iso={s.recorded_on} lang={lang} /> })}
      </span>
      <FullRecording sessionId={s.session_id} />
    </li>
  );
}

/** The analysis-failed sessions: their own grey section (no label: COPY has none; each row says what failed). */
function FailedList({ failed }: { failed: Failed[] }) {
  return (
    <Section testId="listen-failed" first>
      <ul className="flex flex-col overflow-hidden rounded-[16px] bg-cp-grey-fill">
        {failed.map((s) => <FailedRow key={s.session_id} s={s} />)}
      </ul>
    </Section>
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
