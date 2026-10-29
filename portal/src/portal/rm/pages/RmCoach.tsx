import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useLang } from "../../teacher/i18n";
import { CodeText, DateText, WindowMark } from "../../coach/insights/count";
import type { Window } from "../../coach/insights/types";
import { digits } from "../../coach/insights/format";
import { StateBlock } from "../../coach/insights/components/StateBlock";
import { rm } from "../api";
import { useRmLoad } from "../useRmLoad";
import { useRmSession } from "../RmGate";
import { rmPaths } from "../paths";
import type { RmCoach as Detail, RmHome } from "../types";
import { RmNote, RmPage } from "../components/RmFrame";
import { Section } from "../../coachip-ui/Section";
import { Button } from "../../coachip-ui/Button";
import { Pill } from "../../coachip-ui/Pill";
import { SectorWRow, URDU_ISOLATE, windowMeta } from "../components/SectorWRow";
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
/** The windows S9's school rows are graded in (the one the schools card states). */
function schoolWindows(d: Detail): Window[] {
  return windowIds(d.schools.map((s) => s.graded)).map((id) => d.windows.find((w) => w.id === id)).filter((w): w is Window => !!w);
}

function Schools({ d, children }: { d: Detail; children?: ReactNode }) {
  const lang = useLang();
  const allOld = d.schools.length > 0 && d.schools.every((s) => s.weeks_since_visit === null || s.weeks_since_visit >= 4);
  return (
    <Section testId="s9-schools" label={rt("s9.schools.title", lang)}>
      {/* fix-r5 s2 items 15 + 17 (design-qa 073628 §5, 073629): said once above the rows; its "4" is policy, not a count */}
      {allOld && <RmNote testId="s9-no-visits"><span data-nonum="">{rt("s9.schools.never", lang)}</span></RmNote>}
      {/* fix-r5 s3 (qa-rm 171001, B5): the graded counts' window, on this card, so it resolves with no moves block;
          FIX_R6 B1: said once with its grader, and the coach's rows below in the same window drop their own line */}
      {schoolWindows(d).map((w) => <WindowMark key={w.id} window={w} className="text-[13px] leading-[1.45] text-cp-ink-3">{windowMeta(w, lang)}</WindowMark>)}
      <ul className="flex flex-col">
        {d.schools.map((s) => {
          const school = <CodeText lang={lang}>{s.school.school_name}</CodeText>;
          const late = (s.weeks_since_visit ?? 99) >= 4;
          return (
            <li key={s.school.school_id} data-testid="s9-school" data-late={late ? "1" : undefined} className="flex flex-col gap-0.5 border-t border-cp-hairline py-3.5 text-[15px] leading-[1.45] first:border-t-0">
              {/* notice = navy, never amber (DESIGN_SYSTEM §6) */}
              <span data-nonum="" className={`${late ? "font-semibold text-cp-navy" : "text-cp-ink"} ${lang === "ur" ? URDU_ISOLATE : ""}`}>
                {s.last_visit === null || s.weeks_since_visit === null
                  ? allOld ? school : <>{school}{lang === "ur" ? "، " : " · "}{rt("s9.schools.never", lang)}</>
                  : rtx(s.next_visit ? "s9.schools.row" : "s9.schools.row.no_next", lang, {
                    school,
                    date: <DateText iso={s.last_visit} lang={lang} />,
                    w: digits(s.weeks_since_visit, lang),
                    ...(s.next_visit ? { date2: <DateText iso={s.next_visit.date} lang={lang} /> } : {}),
                  })}
              </span>
              <CountLine k="s9.graded" count={s.graded} className="text-[13px] text-cp-ink-3" />
            </li>
          );
        })}
      </ul>
      {children}
    </Section>
  );
}

function Notes({ d }: { d: Detail }) {
  const lang = useLang();
  if (!d.notes.length) return null;
  return (
    <Section testId="s9-notes" label={rt("s9.notes.title", lang)}>
      <ul className="flex flex-col">
        {d.notes.map((n) => (
          <li key={n.id} data-testid="s9-note" data-status={n.status} className="border-t border-cp-hairline py-3.5 first:border-t-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] text-cp-ink-3">
              <Pill tone={n.status === "set" || n.status === "dismissed" ? "tint" : "navy-tint"}>{rt(`s9.notes.status.${n.status}` as const, lang)}</Pill>
              <span>{rtx("s1.note.due", lang, { date: <DateText iso={n.due_on} lang={lang} /> })}</span>
            </div>
            <ol className="flex flex-col gap-0.5 text-[15px] leading-[1.45] text-cp-ink">
              {n.lines[lang].map((l, i) => <li key={i} data-nonum="">{l}</li>)}
            </ol>
          </li>
        ))}
      </ul>
    </Section>
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
      // FIX_R6 B7: a Latin label is one isolated run that wraps only at a space ("Fixture Coach / 01" never splits mid-word)
      title={c ? <bdi data-code="" dir={lang === "ur" ? "ltr" : "auto"} className="[overflow-wrap:normal]">{c.coach_label}</bdi> : rt("nav.rm.coaches", lang)}
      sub={c ? rt(`s9.reason.${c.needs_me_reason ?? "none"}` as const, lang) : undefined}
      backTo={rmPaths.coaches}
      windows={data?.windows}
      testId="rm-coach"
      trust={data ? "s9.trust" : null}
    >
      {!data || !c ? <StateBlock error={error} testId="rm-state" /> : (
        <div className="flex flex-col">
          {/* the screen's one primary, first under the app bar: a coach with many schools pushed it under the phone nav
              when it closed the school list (390x844 shot v2: bottom 789 EN, 974 UR; fold rule, lead-final r11) */}
          <Button testId="s9-follow-up" onClick={openPicker} block className="mt-1 sm:w-auto sm:self-start">
            <span>{rt("s8.follow_up", lang)}</span>
          </Button>
          <Schools d={data} />
          <Section testId="s9-steps" label={rt("s9.steps.title", lang)}
            hint={<WindowLegend windows={data.windows} ids={windowIds(data.steps)} inline className="" />}>
            {/* fix-r5 s2 item 3 (B10): no step set this month is words, never "0 of 0 open · 0 of 0 completed · …" */}
            {data.steps.open.d === 0
              ? <p data-testid="s9-steps-none" className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{rt("s9.steps.none", lang)}</p>
              : (
                <p className="text-[17px] font-semibold leading-[1.4] text-cp-ink">
                  {rtx("s9.steps.row", lang, {}, [
                    { n: "o", d: "d", count: data.steps.open },
                    { n: "c", d: "d", count: data.steps.completed },
                    { n: "v", d: "d", count: data.steps.overdue },
                  ])}
                </p>
              )}
          </Section>
          {data.moves.length > 0 && (
            <Section testId="s9-moves" label={rt("s9.moves.title", lang)}>
              <div className="flex flex-col">
                {data.moves.map((m) => (
                  <SectorWRow key={m.row.w_id} row={m.row} testId="s9-wrow" stated={schoolWindows(data)[0]?.id}
                    sector={m.sector ?? m.row.sector ? { label: sector, count: (m.sector ?? m.row.sector)! } : null} />
                ))}
              </div>
            </Section>
          )}
          <Notes d={data} />
          <Section testId="s9-calibration"><p className="text-[13px] leading-[1.45] text-cp-ink-3">{rt("s9.calibration", lang)}</p></Section>
        </div>
      )}
      {picking && home && c && <FollowUpPicker coach={c} home={home} onClose={() => { setPicking(false); reload(); }} onSent={() => undefined} />}
    </RmPage>
  );
}
