import { useState } from "react";
import { useLang } from "../../teacher/i18n";
import { DateText, LibraryText } from "../../coach/insights/count";
import { todayKarachi } from "../../coach/insights/format";
import { pick } from "../../coach/insights/text";
import { StateBlock } from "../../coach/insights/components/StateBlock";
import type { Count } from "../../coach/insights/types";
import { rm } from "../api";
import { useRmLoad } from "../useRmLoad";
import { useRmSession } from "../RmGate";
import { addDays, wForIntervention } from "../compose";
import type { RmCircle as Circle } from "../types";
import type { RmCopyKey } from "../rm.copy";
import { RmNote, RmPage } from "../components/RmFrame";
import { Section } from "../../coachip-ui/Section";
import { Button } from "../../coachip-ui/Button";
import { CircleRow } from "../components/CircleRow";
import { CountLine } from "../components/CountLine";
import { WindowLegend, windowIds } from "../components/WindowLegend";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — S10, the Friday coach circle (DESIGN §3 S10, CONVERGENCE G3, B22, API R20/R21, COPY §S10): one moment
 * per coach as a single line "coach · school · W · play" (the gloss only when a row opens; no mark, grade, subject or
 * date); the sector moves from the library with their date, who attends and the check, each with "Set this sector step"
 * (POST /coachip/rm/steps; never a broadcast as the whole intervention, A7); and the checks due this week per coach.
 *
 * fix-r5 (SPEC v2.1 §11.1, API R20 `basis`/`floor`): on a `coach` week the floor line sits above the rows, its `{c}` a Count
 * node (n = coaches with 5+ lessons, d = the 3 the floor needs, the sector's 4-week window) so G10 holds; the line's fixed
 * numbers (the floor's 5 lessons) are policy, not counts. No moment on a `coach` week (or a floor with no coach ranked)
 * says `s10.moments.empty.floor`, never a zero.
 */
/** The empty S10 line (red-2 20261027T001002): the floor sentence only when no coach ranks (an absent count reads as 0,
 * the v1.1 behaviour); coaches who rank but have no moment (or a circle stage not yet run) get the neutral line. */
function emptyKey(data: Circle): RmCopyKey {
  if (!(data.basis === "coach" || data.floor)) return "s10.moments.empty";
  return (data.floor?.coaches_ranked ?? 0) > 0 ? "s10.moments.empty.coach" : "s10.moments.empty.floor";
}

function BasisLine({ data }: { data: Circle }) {
  const lang = useLang();
  const c = data.floor?.coaches_with_5plus ?? 0;
  // COPY §8: {c} counts on the sector's 4-week graded window (R20 floor.window_id, listed in windows), not the clip week.
  const win = data.floor?.window_id ?? data.window.id;
  return (
    <div data-testid="s10-basis" className="flex flex-col gap-0.5">
      <WindowLegend windows={data.windows} ids={[win]} />
      <p data-nonum="" className="text-[13px] leading-[1.45] text-cp-ink-2">
        {rtx("s10.moments.basis.coach", lang, {}, [{ n: "c", d: "3", count: { n: c, d: 3, window_id: win } }])}
      </p>
    </div>
  );
}
/**
 * fix-r5 s2 item 11 (qa-rm R3b FAIL 20261027T072544; wA 4aac292734): the server stores a sector step for TODAY only
 * (check_by_rule '14_days': check_by = set_at::date + 14; no planned-date column), so there is no date picker: one tap
 * posts today's Karachi date and the confirmation names today and the check date (today + 14).
 */
function SectorMove({ s, today }: { s: Circle["sector_interventions"][number]; today: string }) {
  const lang = useLang();
  const [state, setState] = useState<"idle" | "saving" | "done" | "failed">("idle");
  const [setFor, setSetFor] = useState<string | null>(null);
  const w = wForIntervention(s.i_id);
  const sep = lang === "ur" ? "، " : " · ";
  const save = async () => {
    if (!w || state === "saving") return;
    setState("saving");
    try {
      const sent = todayKarachi(); // now, not the payload's computed_at: the server checks against its own today
      const { step } = await rm.setSectorStep({ i_id: s.i_id, w_id: w, date: sent });
      setSetFor(step.date || sent);
      setState("done");
    } catch {
      setState("failed");
    }
  };
  return (
    <li data-testid="sector-move" data-i={s.i_id} className="flex flex-col gap-1 border-t border-cp-hairline py-3.5 first:border-t-0">
      <p className="text-[17px] font-semibold leading-[1.4] text-cp-ink">
        {s.date
          ? rtx("s10.sector_moves.row", lang, { title: <LibraryText>{pick(s.title, lang)}</LibraryText>, date: <DateText iso={s.date} lang={lang} />, attendees: <LibraryText>{pick(s.attendees, lang)}</LibraryText> })
          : <><LibraryText>{pick(s.title, lang)}</LibraryText>{sep}<LibraryText>{pick(s.attendees, lang)}</LibraryText></>}
      </p>
      <p className="text-[13px] leading-[1.45] text-cp-ink-3">{rtx("s10.sector_moves.check", lang, { check: <LibraryText>{pick(s.check, lang)}</LibraryText> })}</p>
      {state === "done" && setFor
        ? (
          <p role="status" data-testid="sector-move-done" className="mt-1 self-start rounded-full bg-cp-green-tint px-3 py-[5px] text-[13px] font-semibold text-cp-green-ink">
            {rtx("s10.sector_moves.done.today", lang, { date: <DateText iso={setFor} lang={lang} />, date2: <DateText iso={addDays(setFor, 14)} lang={lang} /> })}
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="md" testId="sector-move-set" onClick={save} disabled={!w || state === "saving"} className="self-start">
              <span>{state === "saving" ? rt("e.saving", lang) : rt("s10.sector_moves.set.today", lang)}</span>
            </Button>
            {state === "failed" && <span role="status" className="text-[13px] font-semibold text-cp-navy">{rt("picker.failed", lang)}</span>}
          </div>
        )}
    </li>
  );
}

export default function RmCircle() {
  const lang = useLang();
  const { sector } = useRmSession();
  const { data, error } = useRmLoad(() => rm.circle(), []);
  const [open, setOpen] = useState<string | null>(null);
  const today = data ? todayKarachi(new Date(data.computed_at)) : todayKarachi();
  if (error === "not_found") {
    return <RmPage title={rt("nav.rm.circle", lang)} testId="rm-circle"><RmNote testId="rm-no-sector">{rt("s8.empty.no_sector", lang)}</RmNote></RmPage>;
  }
  const total: Count | null = data && data.checks_due.length
    ? data.checks_due.reduce((a, c) => ({ n: a.n + c.count.n, d: a.d + c.count.d, window_id: a.window_id }), { n: 0, d: 0, window_id: data.checks_due[0].count.window_id })
    : null;
  return (
    <RmPage title={rt("s10.title", lang, { sector })} sub={data ? <DateText iso={data.week_start} lang={lang} /> : undefined}
      windows={data?.windows} testId="rm-circle" trust={data ? "s8.trust" : null}>
      {!data ? <StateBlock error={error} testId="rm-state" /> : (
        <div className="flex flex-col">
          <Section testId="s10-moments" first label={rt("s10.moments.title", lang)} hint={rt("s10.moments.explain", lang)}>
            {data.moments.length === 0
              // the floor's "20 graded lessons" is policy, not a count
              ? <RmNote testId="s10-moments-empty"><span data-nonum="">{rt(emptyKey(data), lang)}</span></RmNote>
              : (
                <>
                  {data.basis === "coach" && <BasisLine data={data} />}
                  <ul className="flex flex-col">{data.moments.map((m) => <CircleRow key={m.coach_user_id} m={m} open={open === m.coach_user_id} onOpen={setOpen} />)}</ul>
                </>
              )}
          </Section>
          <Section testId="s10-sector-moves" label={rt("s10.sector_moves.title", lang)}>
            {data.sector_interventions.length === 0
              ? <p className="text-[15px] leading-[1.45] text-cp-ink-2">{rt("s10.sector_moves.none", lang)}</p>
              : <ul className="flex flex-col">{data.sector_interventions.map((s) => <SectorMove key={s.i_id} s={s} today={today} />)}</ul>}
          </Section>
          <Section testId="s10-checks" label={rt("s10.checks.title", lang)}
            hint={<WindowLegend windows={data.windows} ids={windowIds(data.checks_due)} inline className="" />}>
            {/* fix-r5 s2 item 3 (B10): a base of 0 is words, never "0 of 0 open steps" */}
            {total && (total.d === 0
              ? <p data-testid="s10-checks-none" className="text-[15px] leading-[1.45] text-cp-ink-2">{rt("s10.checks.sub.none", lang)}</p>
              : <CountLine k="s10.checks.sub" count={total} className="text-[15px] leading-[1.45] text-cp-ink-2" as="p" />)}
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.checks_due.map((c) => (
                <li key={c.coach_label} data-testid="s10-check" className={`rounded-full px-3 py-[5px] text-[13px] font-semibold ${c.count.d === 0 ? "bg-cp-navy-tint text-cp-ink-2" : "bg-cp-green-tint text-cp-green-ink"}`}>
                  {c.count.d === 0
                    ? rtx("s10.checks.row.none", lang, { coach: <span data-code="" dir="auto">{c.coach_label}</span> })
                    : rtx("s10.checks.row", lang, { coach: <span data-code="" dir="auto">{c.coach_label}</span> }, [{ n: "n", d: "d", count: c.count }])}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </RmPage>
  );
}
