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
import { defaultDue, addDays, wForIntervention } from "../compose";
import type { RmCircle as Circle } from "../types";
import type { RmCopyKey } from "../rm.copy";
import { RmCard, RmNote, RmPage } from "../components/RmFrame";
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
      <p data-nonum="" className="text-[13.5px] leading-snug text-[#374151]">
        {rtx("s10.moments.basis.coach", lang, {}, [{ n: "c", d: "3", count: { n: c, d: 3, window_id: win } }])}
      </p>
    </div>
  );
}
function SectorMove({ s, today }: { s: Circle["sector_interventions"][number]; today: string }) {
  const lang = useLang();
  const [date, setDate] = useState(s.date && s.date >= today ? s.date : defaultDue(today));
  const [state, setState] = useState<"idle" | "picking" | "saving" | "done" | "failed">("idle");
  const [setFor, setSetFor] = useState<string | null>(null);
  const w = wForIntervention(s.i_id);
  const sep = lang === "ur" ? "، " : " · ";
  const save = async () => {
    if (!w) return;
    setState("saving");
    try {
      const { step } = await rm.setSectorStep({ i_id: s.i_id, w_id: w, date });
      setSetFor(step.date);
      setState("done");
    } catch {
      setState("failed");
    }
  };
  return (
    <li data-testid="sector-move" data-i={s.i_id} className="flex flex-col gap-1 py-2.5">
      <p className="text-[15px] leading-snug text-[#1d2025]">
        {s.date
          ? rtx("s10.sector_moves.row", lang, { title: <LibraryText>{pick(s.title, lang)}</LibraryText>, date: <DateText iso={s.date} lang={lang} />, attendees: <LibraryText>{pick(s.attendees, lang)}</LibraryText> })
          : <><LibraryText>{pick(s.title, lang)}</LibraryText>{sep}<LibraryText>{pick(s.attendees, lang)}</LibraryText></>}
      </p>
      <p className="text-[13.5px] text-[#6b7280]">{rtx("s10.sector_moves.check", lang, { check: <LibraryText>{pick(s.check, lang)}</LibraryText> })}</p>
      {state === "done" && setFor
        ? <p role="status" data-testid="sector-move-done" className="text-[13.5px] font-semibold text-[#15803d]">{rtx("s10.sector_moves.done", lang, { date: <DateText iso={setFor} lang={lang} /> })}</p>
        : state === "picking" || state === "saving" || state === "failed" ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[13.5px] text-[#374151]">
              {rt("s10.sector_moves.date", lang)}
              <input type="date" dir="ltr" value={date} min={today} max={addDays(today, 28)} data-testid="sector-move-date"
                onChange={(e) => { if (e.target.value) setDate(e.target.value); }} className="min-h-[40px] rounded-xl border border-[#d1d5db] px-2" />
            </label>
            <button type="button" data-testid="sector-move-save" onClick={save} disabled={state === "saving"}
              className="min-h-[40px] rounded-full bg-[#333748] px-4 text-[14px] font-semibold text-white disabled:opacity-40">
              {state === "saving" ? rt("e.saving", lang) : rt("s10.sector_moves.set", lang)}
            </button>
            {state === "failed" && <span role="status" className="text-[13px] text-[#b91c1c]">{rt("picker.failed", lang)}</span>}
          </div>
        ) : (
          <button type="button" data-testid="sector-move-set" onClick={() => setState("picking")} disabled={!w}
            className="min-h-[40px] self-start rounded-full border border-[#d1d5db] px-4 text-[14px] font-semibold text-[#1d2025]">
            {rt("s10.sector_moves.set", lang)}
          </button>
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <RmCard testId="s10-moments" title={rt("s10.moments.title", lang)} sub={rt("s10.moments.explain", lang)}>
            {data.moments.length === 0
              // the floor's "20 graded lessons" is policy, not a count
              ? <RmNote testId="s10-moments-empty"><span data-nonum="">{rt(emptyKey(data), lang)}</span></RmNote>
              : (
                <>
                  {data.basis === "coach" && <BasisLine data={data} />}
                  <ul className="flex flex-col divide-y divide-[#f3f4f6]">{data.moments.map((m) => <CircleRow key={m.moment_id} m={m} open={open === m.moment_id} onOpen={setOpen} />)}</ul>
                </>
              )}
          </RmCard>
          <div className="flex flex-col gap-4">
            <RmCard testId="s10-sector-moves" title={rt("s10.sector_moves.title", lang)}>
              {data.sector_interventions.length === 0
                ? <p className="text-[14px] text-[#374151]">{rt("s10.sector_moves.none", lang)}</p>
                : <ul className="flex flex-col divide-y divide-[#f3f4f6]">{data.sector_interventions.map((s) => <SectorMove key={s.i_id} s={s} today={today} />)}</ul>}
            </RmCard>
            <RmCard testId="s10-checks" title={rt("s10.checks.title", lang)}>
              <WindowLegend windows={data.windows} ids={windowIds(data.checks_due)} />
              {/* fix-r5 s2 item 3 (B10): a base of 0 is words, never "0 of 0 open steps" */}
              {total && (total.d === 0
                ? <p data-testid="s10-checks-none" className="text-[13.5px] text-[#6b7280]">{rt("s10.checks.sub.none", lang)}</p>
                : <CountLine k="s10.checks.sub" count={total} className="text-[13.5px] text-[#6b7280]" as="p" />)}
              <ul className="flex flex-wrap gap-2">
                {data.checks_due.map((c) => (
                  <li key={c.coach_label} data-testid="s10-check" className="rounded-full bg-[#f3f4f6] px-3 py-1.5 text-[13.5px] text-[#1d2025]">
                    {c.count.d === 0
                      ? rtx("s10.checks.row.none", lang, { coach: <span data-code="" dir="auto">{c.coach_label}</span> })
                      : rtx("s10.checks.row", lang, { coach: <span data-code="" dir="auto">{c.coach_label}</span> }, [{ n: "n", d: "d", count: c.count }])}
                  </li>
                ))}
              </ul>
            </RmCard>
          </div>
        </div>
      )}
    </RmPage>
  );
}
