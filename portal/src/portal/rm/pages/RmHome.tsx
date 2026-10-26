import { useState } from "react";
import { useLang } from "../../teacher/i18n";
import { DateText } from "../../coach/insights/count";
import { todayKarachi } from "../../coach/insights/format";
import { pick } from "../../coach/insights/text";
import { StateBlock } from "../../coach/insights/components/StateBlock";
import type { Note } from "../../coach/insights/types";
import { rm } from "../api";
import { useRmLoad } from "../useRmLoad";
import { useRmSession } from "../RmGate";
import type { Coach, RmHome as Home } from "../types";
import { RmCard, RmNote, RmPage } from "../components/RmFrame";
import { OpeningCard } from "../components/OpeningCard";
import { SectorWRow } from "../components/SectorWRow";
import { CircleCard, CoachGroups } from "../components/CoachGroups";
import { ClusterCard } from "../components/ClusterCard";
import FollowUpPicker from "../components/FollowUpPicker";
import { rt, rtx } from "../text";

/**
 * bd-sex15q.17 — S8, the RM's Monday sector card (DESIGN §3 S8, SPEC v2 §3 R17, COPY §S8, CONVERGENCE G4, G8, G9, B9,
 * B23). Left: the opening sentence, the month's two W by school (no coach beside a school, G4), the cluster session and
 * the Monday bar. Right: "Which coach needs me this week" in two groups in the server's order, then the Friday circle.
 * At 1440×900 the needs-me column is above the fold in English and Urdu. Aggregates only: no teacher appears.
 */
export function SectorMoves({ home }: { home: Home }) {
  const lang = useLang();
  return (
    <RmCard testId="rm-moves" title={rt("s8.moves.title", lang)} sub={rt("s8.moves.sub", lang)}>
      <div className="flex flex-col gap-2">
        {home.moves.map((m) => <SectorWRow key={m.row.w_id} row={m.row} bySchool={m.by_school} agenda={m.agenda} />)}
      </div>
    </RmCard>
  );
}

export default function RmHome() {
  const lang = useLang();
  const { sector } = useRmSession();
  const { data, error, reload } = useRmLoad(() => rm.home(), []);
  const [picking, setPicking] = useState<{ coach: Coach; queue: Coach[] } | null>(null);
  const today = data ? todayKarachi(new Date(data.computed_at)) : todayKarachi();
  const title = rt("s8.title", lang, { sector: data?.sector ?? sector });

  const sent = (_note: Note) => { /* the next read shows it under the coach row and on S9 */ };
  const close = () => {
    const next = picking?.queue[0];
    setPicking(next ? { coach: next, queue: picking!.queue.slice(1) } : null);
    if (!next) reload();
  };
  const monday = () => {
    if (!data) return;
    const due = data.groups.needs_me.filter((c) => !c.note_open);
    const list = due.length ? due : data.groups.needs_me;
    if (list.length) setPicking({ coach: list[0], queue: list.slice(1) });
  };

  if (error === "not_found") {
    return (
      <RmPage title={rt("nav.rm.sector", lang)} testId="rm-home">
        <RmNote testId="rm-no-sector">{rt("s8.empty.no_sector", lang)}</RmNote>
      </RmPage>
    );
  }
  return (
    // s8.sub is the date only (COPY v1.1 §8: the coach and school counts had no Count behind them)
    <RmPage title={title} sub={rtx("s8.sub", lang, { date: <DateText iso={today} lang={lang} /> })} windows={data?.windows} testId="rm-home" trust={data ? "s8.trust" : null}>
      {!data ? <StateBlock error={error} testId="rm-state" /> : (
        <div className="flex flex-col gap-4">
          {data.stale && (
            <RmNote testId="rm-stale" tone="info">{rtx("s8.empty.stale", lang, { date: <DateText iso={data.stale.as_of} lang={lang} /> })}</RmNote>
          )}
          {data.empty && <RmNote testId="rm-empty">{pick(data.empty.message, lang)}</RmNote>}
          <OpeningCard home={data} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="order-2 flex flex-col gap-4 lg:order-1">
              {data.moves.length > 0 && <SectorMoves home={data} />}
              <ClusterCard home={data} />
              <button type="button" data-testid="rm-monday" onClick={monday}
                className="flex flex-col gap-0.5 rounded-2xl bg-[#eef2ff] px-4 py-3.5 text-start text-[#312e81] hover:bg-[#e0e7ff]">
                <span className="text-[15.5px] font-semibold">{rt("s8.monday.button", lang)}</span>
                <span className="text-[13.5px]">{rt("s8.monday.sub", lang)}</span>
              </button>
            </div>
            <div className="order-1 flex flex-col gap-4 lg:order-2">
              <CoachGroups home={data} onFollowUp={(c) => setPicking({ coach: c, queue: [] })} />
              <CircleCard home={data} />
            </div>
          </div>
        </div>
      )}
      {picking && data && (
        <FollowUpPicker key={picking.coach.coach_user_id} coach={picking.coach} home={data} onClose={close} onSent={sent} />
      )}
    </RmPage>
  );
}
