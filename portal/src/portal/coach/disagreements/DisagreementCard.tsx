import { useState } from "react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { AudioPlayer } from "../../newui/AudioPlayer";
import { Chip } from "../../newui/Chip";
import { FOCUS, PRIMARY_WIDE, ROW_SUB } from "../../teacher/ui/styles";
import { disagreements, type Card } from "./api";
import { DISAGREE } from "./copy";
import { DisagreementsFrame, Gated } from "./frame";
import { ClipProvider, FullReport, ReasonBlock, WhereToLook } from "./cardParts";

/**
 * bd-tbprit.3 — one teacher's disagreement, evidence only (Amena, 19 Oct), in Rifat's order:
 *
 *   A  what she disagrees with — each reason with the grader's own evidence; her voice note; what the report told her
 *   B  where to look — the four sections, closed, every indicator with its AI score and a Listen per timed item
 *      her trend, then the full DC report
 *      "I have visited" — one-way (the tracker's visited_7d reads it); a done card has no button
 *
 * No coaching suggestion, no message/call, no "Recording less": not before the 7 Dec read.
 */

const H2 = "text-[17px] font-bold text-[#1d2025]";

function Visit({ id, done }: { id: string; done: boolean }) {
  const C = useCopy(DISAGREE);
  const [isDone, setDone] = useState(done);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (isDone) return <div data-testid="visit-state"><Chip tone="done">{C.visited}</Chip></div>;
  const tap = async () => {
    setSaving(true);
    setFailed(false);
    const ok = await disagreements.visited(id);
    setSaving(false);
    if (ok) setDone(true); else setFailed(true);
  };
  return (
    <div className="flex flex-col gap-2">
      {failed ? <p role="alert" className="text-[14px] text-[#c8331f]">{C.saveFailed}</p> : null}
      <button type="button" onClick={tap} disabled={saving} className={cn(PRIMARY_WIDE, FOCUS)}>{C.visit}</button>
    </div>
  );
}

function Loaded({ card }: { card: Card }) {
  const C = useCopy(DISAGREE);
  const { wells, thing, journey } = card.view;
  return (
    <ClipProvider id={card.id}>
      <div className="flex flex-col gap-3">
        <h2 className={H2}>{C.disagreesWith}</h2>
        {card.evidence.map((e) => <ReasonBlock key={e.code} e={e} />)}
        {card.noteUrl ? (
          <div className="flex flex-col gap-1.5">
            <p className={ROW_SUB}>{C.herNote}</p>
            <AudioPlayer src={card.noteUrl} label={C.herNote} testId="disagreement-note" />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5 rounded-2xl border border-[#e5e7eb] bg-white p-4">
          <p className={ROW_SUB}>{C.reportSaid}</p>
          <p className="text-[14px] font-semibold">{C.didWell}</p>
          {wells.length ? <ul className="list-disc ps-5">{wells.map((w) => <li key={w} dir="auto">{w}</li>)}</ul> : <p>{C.dash}</p>}
          <p className="text-[14px] font-semibold">{C.thingToTry}</p>
          <p dir="auto">{thing ? thing.text : C.dash}</p>
        </div>
      </div>

      <WhereToLook card={card} />

      <div data-testid="trend" className="flex flex-col gap-1">
        <h2 className={H2}>{C.trend}</h2>
        <p className="text-[16px]">{journey?.points.length ? journey.points.join(C.arrow) : C.dash}</p>
      </div>

      <FullReport card={card} />

      <Visit id={card.id} done={card.done} />
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
