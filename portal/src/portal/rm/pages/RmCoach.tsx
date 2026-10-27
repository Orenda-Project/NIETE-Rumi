import { useState } from "react";
import { useParams } from "react-router-dom";
import { useLang } from "../../teacher/i18n";
import { CodeText, DateText } from "../../coach/insights/count";
import { digits } from "../../coach/insights/format";
import { StateBlock } from "../../coach/insights/components/StateBlock";
import { rm } from "../api";
import { useRmLoad } from "../useRmLoad";
import { useRmSession } from "../RmGate";
import { rmPaths } from "../paths";
import type { RmCoach as Detail, RmHome } from "../types";
import { RmCard, RmNote, RmPage } from "../components/RmFrame";
import { SectorWRow } from "../components/SectorWRow";
import { CountLine } from "../components/CountLine";
import { WindowLegend, windowIds } from "../components/WindowLegend";
import FollowUpPicker from "../components/FollowUpPicker";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — S9, one coach for the RM (DESIGN §3 S9, SPEC v2 §3 "S9", API R18, COPY §S9): the coach's label and group
 * reason; the schools held, each with weeks since the last visit against the floor of 4 and the next visit; this month's
 * steps as three counts; the coach's two moves as rows with the sector's count beside them; the follow-ups this RM sent
 * with their status; "Send follow-up" (S8's picker); the calibration placeholder; the trust line. No per-teacher number,
 * no code, no disagreement rate, no leniency flag (A8, A9). "No visit in 4 weeks" is the signal, not a fault.
 */
function Schools({ d }: { d: Detail }) {
  const lang = useLang();
  const allOld = d.schools.length > 0 && d.schools.every((s) => s.weeks_since_visit === null || s.weeks_since_visit >= 4);
  return (
    <RmCard testId="s9-schools" title={rt("s9.schools.title", lang)}>
      {/* fix-r5 s2 items 15 + 17 (design-qa 073628 §5, 073629): said once above the rows; its "4" is policy, not a count */}
      {allOld && <RmNote testId="s9-no-visits"><span data-nonum="">{rt("s9.schools.never", lang)}</span></RmNote>}
      <ul className="flex flex-col divide-y divide-[#f3f4f6]">
        {d.schools.map((s) => {
          const school = <CodeText lang={lang}>{s.school.school_name}</CodeText>;
          const late = (s.weeks_since_visit ?? 99) >= 4;
          return (
            <li key={s.school.school_id} data-testid="s9-school" data-late={late ? "1" : undefined} className="flex flex-col gap-0.5 py-2 text-[14.5px]">
              <span data-nonum="" className={late ? "font-semibold text-[#92400e]" : "text-[#1d2025]"}>
                {s.last_visit === null || s.weeks_since_visit === null
                  ? allOld ? school : <>{school}{lang === "ur" ? "، " : " · "}{rt("s9.schools.never", lang)}</>
                  : rtx(s.next_visit ? "s9.schools.row" : "s9.schools.row.no_next", lang, {
                    school,
                    date: <DateText iso={s.last_visit} lang={lang} />,
                    w: digits(s.weeks_since_visit, lang),
                    ...(s.next_visit ? { date2: <DateText iso={s.next_visit.date} lang={lang} /> } : {}),
                  })}
              </span>
              <CountLine k="s9.graded" count={s.graded} className="text-[12.5px] text-[#6b7280]" />
            </li>
          );
        })}
      </ul>
    </RmCard>
  );
}

function Notes({ d }: { d: Detail }) {
  const lang = useLang();
  if (!d.notes.length) return null;
  return (
    <RmCard testId="s9-notes" title={rt("s9.notes.title", lang)}>
      <ul className="flex flex-col gap-3">
        {d.notes.map((n) => (
          <li key={n.id} data-testid="s9-note" data-status={n.status} className="rounded-xl bg-[#f9fafb] px-3 py-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[#6b7280]">
              <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-[#374151]">{rt(`s9.notes.status.${n.status}` as const, lang)}</span>
              <span>{rtx("s1.note.due", lang, { date: <DateText iso={n.due_on} lang={lang} /> })}</span>
            </div>
            <ol className="flex flex-col gap-0.5 text-[14px] leading-snug text-[#1d2025]">
              {n.lines[lang].map((l, i) => <li key={i} data-nonum="">{l}</li>)}
            </ol>
          </li>
        ))}
      </ul>
    </RmCard>
  );
}

export default function RmCoach() {
  const lang = useLang();
  const { coachUserId = "" } = useParams();
  const { sector } = useRmSession();
  const { data, error, reload } = useRmLoad(() => rm.coach(coachUserId), [coachUserId]);
  const [home, setHome] = useState<RmHome | null>(null);
  const [picking, setPicking] = useState(false);
  const openPicker = () => {
    if (home) { setPicking(true); return; }
    rm.home().then((h) => { setHome(h); setPicking(true); }, () => undefined);
  };
  if (error === "not_found") {
    return <RmPage title={rt("nav.rm.coaches", lang)} backTo={rmPaths.coaches} testId="rm-coach"><RmNote testId="rm-coach-404">{rt("e.404", lang)}</RmNote></RmPage>;
  }
  const c = data?.coach;
  return (
    <RmPage
      title={c ? <span data-code="" dir="auto">{c.coach_label}</span> : rt("nav.rm.coaches", lang)}
      sub={c ? rt(`s9.reason.${c.needs_me_reason ?? "none"}` as const, lang) : undefined}
      backTo={rmPaths.coaches}
      windows={data?.windows}
      testId="rm-coach"
      trust={data ? "s9.trust" : null}
    >
      {!data || !c ? <StateBlock error={error} testId="rm-state" /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Schools d={data} />
            <RmCard testId="s9-steps" title={rt("s9.steps.title", lang)}>
              <WindowLegend windows={data.windows} ids={windowIds(data.steps)} />
              {/* fix-r5 s2 item 3 (B10): no step set this month is words, never "0 of 0 open · 0 of 0 completed · …" */}
              {data.steps.open.d === 0
                ? <p data-testid="s9-steps-none" className="text-[15px] text-[#1d2025]">{rt("s9.steps.none", lang)}</p>
                : (
                  <p className="text-[15px] text-[#1d2025]">
                    {rtx("s9.steps.row", lang, {}, [
                      { n: "o", d: "d", count: data.steps.open },
                      { n: "c", d: "d", count: data.steps.completed },
                      { n: "v", d: "d", count: data.steps.overdue },
                    ])}
                  </p>
                )}
            </RmCard>
          </div>
          <div className="flex flex-col gap-4">
            <button type="button" data-testid="s9-follow-up" onClick={openPicker}
              className="min-h-[48px] rounded-full bg-[#333748] px-5 text-[15px] font-semibold text-white">
              {rt("s8.follow_up", lang)}
            </button>
            {data.moves.length > 0 && (
              <RmCard testId="s9-moves" title={rt("s9.moves.title", lang)}>
                <div className="flex flex-col gap-2">
                  {data.moves.map((m) => (
                    <SectorWRow key={m.row.w_id} row={m.row} testId="s9-wrow"
                      sector={m.sector ?? m.row.sector ? { label: sector, count: (m.sector ?? m.row.sector)! } : null} />
                  ))}
                </div>
              </RmCard>
            )}
            <Notes d={data} />
            <RmCard testId="s9-calibration"><p className="text-[14px] text-[#6b7280]">{rt("s9.calibration", lang)}</p></RmCard>
          </div>
        </div>
      )}
      {picking && home && c && <FollowUpPicker coach={c} home={home} onClose={() => { setPicking(false); reload(); }} onSent={() => undefined} />}
    </RmPage>
  );
}
