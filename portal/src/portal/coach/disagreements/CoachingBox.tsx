import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { FOCUS, OUTLINE_WIDE, PRIMARY_WIDE, ROW_SUB } from "../../teacher/ui/styles";
import { disagreements, type Card, type Mode, type PlanPatch, type Suggestion } from "./api";
import { COACHING } from "./coachingCopy";
import { DISAGREE } from "./copy";
import { clock, Listen } from "./cardParts";
import { problemPart } from "./sections";
import { firstName, message, stepOf, suggestedWay, template, waLink, warningsOf, type Warning } from "./suggestion";

/**
 * bd-tbprit.11 — Rifat's "💡 Coaching suggestion", with Amena's four answers (20 Oct). The disclaimer, then
 *   1 listen to the problem part, 2 what did you find (four answers), 3 the suggested way (★ and why; any way can be
 *   tapped), 4 what to do: a message (editable Urdu, sent as a wa.me link), a call (ask / if stuck / agree / next
 *   recording) or a visit (steps, "Add to my next visit").
 * The template shows at once; the AI-tailored version replaces it when it arrives, a failed AI keeps the template,
 * and a coach's own edit to the message is never overwritten. "The teacher was right" flags the report for the DC
 * team, with Undo. Every choice is saved on the request; a failed save says so.
 */

const ICON: Record<Mode, string> = { msg: "💬", call: "📞", visit: "🏫" };
const MODES: Mode[] = ["msg", "call", "visit"];
const H3 = "text-[15px] font-bold text-[#1d2025]";
const NOTE = "rounded-xl bg-[#ecfdf3] px-3 py-2 text-[14px] font-semibold text-[#067647]";
const LINK = "text-[14px] font-semibold text-[#33374a] underline";

type Words = typeof COACHING.en;

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-[#f0f1f3] pt-3">
      <h3 className={cn(H3, "flex items-center gap-2")}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#33374a] text-[13px] text-white">{n}</span>
        <span>{title}</span>
      </h3>
      {hint ? <p className={ROW_SUB}>{hint}</p> : null}
      {children}
    </section>
  );
}

function ListenStep({ card, C }: { card: Card; C: Words }) {
  const W = useCopy(DISAGREE).where;
  const { listenFor, part } = problemPart(card);
  const dur = card.durationSec ?? null;
  return (
    <Step n={1} title={C.s1} hint={C.s1h}>
      {part === "notRecorded" ? (
        <p className="text-[14px] font-semibold text-[#c8331f]">{W.notInRecording(clock(dur as number))}</p>
      ) : part ? (
        <Listen k="coach-box" at={part.from} to={part.to} />
      ) : (
        <p className={ROW_SUB}>{C.noPart}</p>
      )}
      {listenFor ? <p dir="auto" className="text-[14px] text-[#374151]">{C.listenFor(listenFor)}</p> : null}
    </Step>
  );
}

const reasonOf = (C: Words, w: Warning) =>
  w.kind === "missed" ? C.reasons.missed(w.step, w.n, w.of) : w.kind === "repeat" ? C.reasons.repeat(w.nth) : C.reasons.recordingLess;

function whyOf(C: Words, found: number, warnings: Warning[]): string {
  if (found === 0) return C.why.right;
  if (found === 2) return C.why.fit;
  if (found === 3) return C.why.notRec;
  return warnings.length ? C.why.helpUp(reasonOf(C, warnings[0])) : C.why.help;
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[14px] font-semibold">{title}</p>
      <ul className="list-disc ps-5 text-[14px] text-[#374151]">{items.map((x) => <li key={x} dir="auto">{x}</li>)}</ul>
    </div>
  );
}

const Line = ({ title, text }: { title: string; text: string }) => (
  <div className="flex flex-col gap-1">
    <p className="text-[14px] font-semibold">{title}</p>
    <p dir="auto" className="text-[14px] text-[#374151]">{text}</p>
  </div>
);

export function CoachingBox({ card }: { card: Card }) {
  const C = useCopy(COACHING);
  const plan = card.plan ?? null;
  const warnings = warningsOf(card);
  const [found, setFound] = useState<number | null>(plan?.found ?? null);
  const [mode, setMode] = useState<Mode | null>(plan?.mode ?? (plan?.found != null ? suggestedWay(plan.found, warnings) : null));
  const [flagged, setFlagged] = useState(plan?.flagged ?? false);
  const [added, setAdded] = useState(plan?.addedToVisit ?? false);
  const [sent, setSent] = useState(plan?.sent ?? false);
  const [failed, setFailed] = useState(false);
  const [ai, setAi] = useState<Suggestion | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (found == null) return;
    let live = true;
    disagreements.suggestion(card.id, found).then((s) => { if (live && s) setAi(s); });
    return () => { live = false; };
  }, [card.id, found]);

  const save = (patch: PlanPatch) => {
    disagreements.savePlan(card.id, patch).then((p) => setFailed(p == null));
  };

  const chooseFound = (f: number) => {
    const way = suggestedWay(f, warnings);
    const patch: PlanPatch = { found: f, mode: way };
    if (f === 0) patch.flagged = true;
    else if (flagged) patch.flagged = false;
    setFound(f); setMode(way); setAi(null); setDraft(null);
    if ("flagged" in patch) setFlagged(patch.flagged as boolean);
    save(patch);
  };
  const flag = (on: boolean) => { setFlagged(on); save({ flagged: on }); };
  const chooseMode = (m: Mode) => { setMode(m); save({ mode: m }); };
  const addToVisit = (on: boolean) => { setAdded(on); save({ addedToVisit: on }); };

  const suggested = found == null ? null : suggestedWay(found, warnings);
  const t = found == null ? null : ai ?? template(C, found, stepOf(card));
  const name = firstName(card.teacher);
  const text = draft ?? (found == null ? "" : message(found, name, ai?.msg));
  const link = waLink(card.phone, text);
  const opts = [C.found.right, C.found.help, C.found.fit, C.found.notRec];
  const min = card.durationSec ? Math.round(card.durationSec / 60) : null;

  return (
    <div data-testid="coaching-box" className="flex flex-col gap-3 rounded-[18px] border border-[#e1e4ea] bg-white p-4">
      <h2 className="text-[17px] font-bold text-[#1d2025]">{C.box}</h2>
      <p className="rounded-xl bg-[#f4f5f8] px-3 py-2 text-[14px] text-[#374151]">{C.disc}</p>
      {failed ? <p role="alert" className="text-[14px] font-semibold text-[#c8331f]">{C.saveFailed}</p> : null}

      <ListenStep card={card} C={C} />

      <Step n={2} title={C.s2} hint={C.s2h}>
        <div className="flex flex-col gap-2">
          {opts.map((o, i) => {
            const sub = i === 3 ? (min ? C.found.notRec.sub(min) : C.found.notRec.subNoLen) : (o as { sub: string }).sub;
            return (
              <button key={o.label} type="button" data-testid="cb-found" aria-pressed={found === i} onClick={() => chooseFound(i)}
                className={cn("flex flex-col items-start gap-0.5 rounded-2xl border px-4 py-3 text-start", FOCUS,
                  found === i ? "border-2 border-[#33374a] bg-[#f4f5f8]" : "border-[#d1d5db] bg-white")}>
                <span className="text-[15px] font-semibold">{o.label}</span>
                <span className={ROW_SUB}>{sub}</span>
              </button>
            );
          })}
        </div>
        {found === 0 ? (
          flagged ? (
            <div className="flex items-center justify-between gap-2">
              <p className={NOTE}>{C.autoFlag}</p>
              <button type="button" className={cn(LINK, FOCUS)} onClick={() => flag(false)}>{C.undo}</button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className={ROW_SUB}>{C.unflagged}</p>
              <button type="button" className={cn(LINK, FOCUS)} onClick={() => flag(true)}>{C.reflag}</button>
            </div>
          )
        ) : null}
      </Step>

      <Step n={3} title={C.s3} hint={found == null ? undefined : C.s3h}>
        {found == null ? <p className={ROW_SUB}>{C.pick}</p> : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => chooseMode(m)}
                  className={cn("flex flex-col items-center gap-0.5 rounded-2xl border px-2 py-2.5 text-center", FOCUS,
                    mode === m ? "border-2 border-[#33374a] bg-[#f4f5f8]" : "border-[#d1d5db] bg-white")}>
                  <span className="text-[15px] font-semibold">{ICON[m]} {C.modes[m]}</span>
                  <span className={ROW_SUB}>{C.when[m]}</span>
                  {suggested === m ? <span className="text-[12px] font-bold text-[#9a6200]">★ {C.rec}</span> : null}
                </button>
              ))}
            </div>
            {suggested ? (
              <p data-testid="cb-why" className="text-[14px] text-[#374151]">
                <span className="font-semibold">{ICON[suggested]} {C.modes[suggested]}: </span>{whyOf(C, found, warnings)}
              </p>
            ) : null}
          </>
        )}
      </Step>

      {found != null && mode && t ? (
        <Step n={4} title={C.s4}>
          <div data-testid="cb-step4" className="flex flex-col gap-3">
            {mode === "msg" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold">{C.msgL}</span>
                  <textarea dir="rtl" rows={4} value={text} onChange={(e) => setDraft(e.target.value)}
                    className={cn("rounded-xl border border-[#d1d5db] p-3 text-[15px] leading-[2]", FOCUS)} />
                </label>
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" onClick={() => { setSent(true); save({ sent: true }); }}
                    className={cn(PRIMARY_WIDE, FOCUS)}>{C.send}{name}{C.send0s}</a>
                ) : <p className={ROW_SUB}>{C.noPhone}</p>}
                {sent && link ? <p className={ROW_SUB}>{C.sent}</p> : null}
              </>
            ) : mode === "call" ? (
              found === 0 ? <p dir="auto" className="text-[14px]">{C.rightCall}</p> : (
                <>
                  <List title={C.qs} items={t.qs} />
                  <List title={C.stuck} items={t.stuck} />
                  <Line title={C.agree} text={t.agree} />
                  <Line title={C.check} text={t.check} />
                </>
              )
            ) : found === 0 ? <p className="text-[14px]">{C.noVisit}</p> : (
              <>
                <List title={C.s4} items={t.visit} />
                <Line title={C.agree} text={t.agree} />
                <Line title={C.check} text={t.check} />
                {added ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className={NOTE}>{C.added}</p>
                    <button type="button" className={cn(LINK, FOCUS)} onClick={() => addToVisit(false)}>{C.undo}</button>
                  </div>
                ) : (
                  <button type="button" className={cn(OUTLINE_WIDE, FOCUS)} onClick={() => addToVisit(true)}>{C.addVisit}</button>
                )}
              </>
            )}
          </div>
        </Step>
      ) : null}
    </div>
  );
}
