import { useState } from "react";
import { Send } from "lucide-react";
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
import { RmNote, RmPage } from "../components/RmFrame";
import { Surface } from "../../coachip-ui/Surface";
import { Section } from "../../coachip-ui/Section";
import { Button } from "../../coachip-ui/Button";
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
export function SectorMoves({ home, overlap = true }: { home: Home; overlap?: boolean }) {
  const lang = useLang();
  // bd-sex15q.47 (R6, SCREENS S8): the one raised surface, riding up over the band on a phone; flat in its column on a
  // laptop, where the band's body is the hero card
  return (
    <Surface testId="rm-moves" overlap={overlap} className="lg:!rounded-none lg:!bg-transparent lg:!p-0 lg:!shadow-none">
      <div>
        <h2 className="text-[20px] font-bold leading-[1.3] text-cp-navy lg:text-[12px] lg:font-bold lg:uppercase lg:tracking-[0.08em] lg:text-cp-ink-3 lg:rtl:text-[13px] lg:rtl:tracking-normal">{rt("s8.moves.title", lang)}</h2>
        <p className="mt-1 text-[13px] leading-[1.45] text-cp-ink-3">{rt("s8.moves.sub", lang)}</p>
      </div>
      <div className="flex flex-col">
        {home.moves.map((m) => <SectorWRow key={m.row.w_id} row={m.row} bySchool={m.by_school} agenda={m.agenda} />)}
      </div>
    </Surface>
  );
}

/** The Monday compose (S8): the screen's one primary; a white card at the top of the laptop's right column. */
function Monday({ onClick }: { onClick: () => void }) {
  const lang = useLang();
  return (
    <section data-testid="rm-compose" className="order-last mt-5 flex flex-col gap-3 border-t border-cp-hairline pt-6 lg:order-first lg:mt-0 lg:rounded-[20px] lg:border-0 lg:bg-cp-surface lg:p-6 lg:shadow-[0_2px_8px_rgba(51,55,72,0.08)]">
      <Button testId="rm-monday" onClick={onClick} block icon={<Send size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0 rtl:-scale-x-100" />}>
        <span className="whitespace-normal text-start">{rt("s8.monday.button", lang)}</span>
      </Button>
      <p className="text-[13px] leading-[1.45] text-cp-ink-3">{rt("s8.monday.sub", lang)}</p>
    </section>
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
    <RmPage title={title} sub={rtx("s8.sub", lang, { date: <DateText iso={today} lang={lang} /> })} windows={data?.windows} testId="rm-home" trust={data ? "s8.trust" : null}
      hero={data ? <OpeningCard home={data} /> : undefined}>
      {!data ? <StateBlock error={error} testId="rm-state" /> : (
        <>
          {data.stale && (
            <div className="mb-2 lg:mb-6"><RmNote testId="rm-stale" tone="info">{rtx("s8.empty.stale", lang, { date: <DateText iso={data.stale.as_of} lang={lang} /> })}</RmNote></div>
          )}
          {data.empty && <div className="mb-2 lg:mb-6"><RmNote testId="rm-empty">{pick(data.empty.message, lang)}</RmNote></div>}
        <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.25fr)_minmax(0,0.95fr)] lg:items-start lg:gap-x-8 lg:pt-4">
          {data.moves.length > 0 && <SectorMoves home={data} overlap={!data.stale && !data.empty} />}
          <CoachGroups home={data} first={data.moves.length === 0} className="lg:mt-0 lg:border-t-0 lg:pt-0" onFollowUp={(c) => setPicking({ coach: c, queue: [] })} />
          <div className="flex flex-col">
            <Monday onClick={monday} />
            <ClusterCard home={data} />
            <Section>
              <CircleCard home={data} />
            </Section>
          </div>
        </div>
        </>
      )}
      {picking && data && (
        <FollowUpPicker key={picking.coach.coach_user_id} coach={picking.coach} home={data} onClose={close} onSent={sent} />
      )}
    </RmPage>
  );
}
