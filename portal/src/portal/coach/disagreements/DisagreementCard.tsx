import { useParams } from "react-router-dom";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { AudioPlayer } from "../../newui/AudioPlayer";
import { ROW_SUB } from "../../teacher/ui/styles";
import { disagreements, type Card } from "./api";
import { DISAGREE } from "./copy";
import { DisagreementsFrame, Gated } from "./frame";
import { ClipProvider, FullReport, ReasonBlock } from "./cardParts";
import { WhereToLook } from "./whereToLook";
import { Banner, CardHead, ReasonPills } from "./cardTop";
import { DoneBadge, DoneBar } from "./doneBar";
import { PatternSection } from "./patternSection";

/**
 * bd-tbprit.3 — one teacher's disagreement, evidence only (Amena, 19 Oct), in Rifat's order:
 *
 *      the top (bd-tbprit.8, Rifat's prototype) — the dark head, the pink banner
 *   A  what she disagrees with — her reasons as pills, her voice note, each reason with the grader's own evidence,
 *      what the report told her (Strength / One thing to try)
 *   B  where to look (bd-tbprit.9) — one Listen for the problem part, the plan's moves, the other three sections
 *      3. is this a pattern? (bd-tbprit.10) — her last lessons as Rifat's line and four facts, then the full DC report
 *      the footer (bd-tbprit.12) — "✓ Mark as done", or on a done card the ✓ Done badge and "Move back to To do"
 *
 * The coaching suggestion and message/call (bd-tbprit.11) are not built yet.
 */

const H2 = "text-[17px] font-bold text-[#1d2025]";

function Loaded({ card }: { card: Card }) {
  const C = useCopy(DISAGREE);
  const { wells, thing } = card.view;
  return (
    <ClipProvider id={card.id}>
      <CardHead card={card} />
      <DoneBadge done={card.done} />
      <Banner card={card} />
      <div className="flex flex-col gap-3 rounded-[18px] border border-[#e1e4ea] bg-white p-4">
        <h2 className={H2}>{C.disagreesWith}</h2>
        <ReasonPills reasons={card.reasons} />
        {card.noteUrl ? (
          <div className="flex flex-col gap-1.5">
            <p className={ROW_SUB}>{C.herNote}</p>
            <AudioPlayer src={card.noteUrl} label={C.herNote} testId="disagreement-note" />
          </div>
        ) : null}
        {card.evidence.map((e) => <ReasonBlock key={e.code} e={e} />)}
        <div className="flex flex-col gap-1.5 border-t border-[#e1e4ea] pt-3">
          <p className={ROW_SUB}>{C.reportSaid}</p>
          <p className="text-[14px] font-semibold">{C.didWell}</p>
          {wells.length ? <ul className="list-disc ps-5">{wells.map((w) => <li key={w} dir="auto">{w}</li>)}</ul> : <p>{C.dash}</p>}
          <p className="text-[14px] font-semibold">{C.thingToTry}</p>
          <p dir="auto">{thing ? thing.text : C.dash}</p>
        </div>
      </div>

      <WhereToLook card={card} />

      {card.pattern ? <PatternSection p={card.pattern} /> : null}

      <FullReport card={card} />

      <DoneBar id={card.id} done={card.done} teacher={card.teacher ?? C.dash} />
    </ClipProvider>
  );
}

function Body() {
  const C = useCopy(DISAGREE);
  const { id = "" } = useParams();
  const [load, retry] = useLoad(() => disagreements.card(id), `coach:disagreement:${id}`);
  const card = dataOf(load);
  return (
    <DisagreementsFrame
      title={card ? card.teacher ?? C.dash : C.title}
      sub={C.cardSub}
      mark="N"
      backTo="/portal/coach/disagreements"
      testId="coach-disagreement"
    >
      <LoadState status={load.status} empty={false} onRetry={retry} />
      {card ? <Loaded card={card} /> : null}
    </DisagreementsFrame>
  );
}

export default function DisagreementCard() {
  return <Gated><Body /></Gated>;
}
