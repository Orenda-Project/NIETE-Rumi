import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftObservationNote, DraftSection, EvidenceReview, ObservationDraft, V6Indicator } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui";
import { FOCUS, GRID, LIST_CARD, OUTLINE_WIDE, PRIMARY_WIDE } from "../../teacher/ui/styles";
import { BottomButton } from "../ui";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FORM_V7, type FormV7Copy } from "../flow/copyV7form";
import ReportsFrame from "./ReportsFrame";
import { REPORTS, type ReportsCopy } from "./copy";
import type { Values } from "./formModel";
import {
  AboutLine, DcEvidenceBox, DcNote, DcQuoteRow, DockV7, FormChips, FormToast, Legend, Levels, NextButton, OwnEvidence, SaveTrayV7,
  TextBox, focusField, levelWords, urduOf, useFormToast, v7Changes, v7Crumb,
} from "./FormV7";
import { Problem, problemText, V6Notes, v6RatingOptions } from "./V6Parts";
import { IndicatorNav, IndicatorRow, IndicatorRows, SectionChips, SectionHead, SectionList } from "./FormV7Nav";
import { changedFromRumi, v6Problems, type V6Problems, type V6Section } from "./v6Model";
import { useFormLevels } from "./formLevels";
import { dropV7, heldV7, initialReview, keepV7, ownReview, plainReview, reviewOut, sameReview, type Review } from "./evidenceReview";
import { TimeChip, useLessonPlayer, type LessonPlayer } from "./lessonPlayer";

/**
 * bd-o15qnr.31 (queue #204; #188's canvas-ff: "21 Nov: the Feedback Form review", and "21 Nov ~10:05: LOCKED for #204,
 * evidence option B with editing") — the FICO17 v6 Feedback Form on the v6/v7 switch, coach and principal (the
 * principal's app shows no overall score; this form shows none), English and Urdu. Boards: ff-outer, ff-list,
 * ff-detail, ff-b-menu, ff-b-removed, ff-b-add, ff-b-saved, ff-autosize (+ -p, -ur).
 *
 *   sections        every section collapsed: B, C, D, F as rows, each with a green mark when complete and a yellow one
 *                   when not, and "n/m done". Save looks disabled until every section is green; tapped before, it says
 *                   how many items are left (a toast) and focuses the first yellow section.
 *   a section       the section chips (B/C/D/F with their counts, green or yellow), "n of m checked", one row per
 *                   indicator: code, name, level chip, the NIETE Teaching Assistant's one line, a green or yellow mark,
 *                   ›. "Next to check" walks the yellow rows. B (the lesson plan) shows its moves as they are today.
 *   one indicator   prev/next, the level (the assistant's ringed), the evidence, "To improve", "Agree and next".
 *                   An indicator is green when its rules hold (v6Model's, and a level) AND the coach has agreed it (one
 *                   of the assistant's 11) or set it (one of the six); a saved form counts as agreed. Gaps: a counted
 *                   toast, the first unfilled field scrolled to and focused, the inline marks kept.
 *   evidence        queue #251 (the operator 24 Nov ~10:25; was option B, the quotes edited in place): the Digital
 *                   Coach's evidence ONCE, read only: its line and each {time, quote} (Urdu right to left in Nastaliq);
 *                   "Edit evidence" opens an EMPTY "Your evidence" box under it ("Keep the Digital Coach’s" closes it).
 *                   No assistant list (an older bot): today's one Evidence box.
 *   the time chip   plays the class recording from that time in a player under the evidence (lessonPlayer.tsx).
 *   saved           the same keys as today: ev_<code> is her words when she typed some, else the server's own text, as
 *                   it came (the bot's `rumiText` tells the two apart on a saved form); `evidence_review` per indicator
 *                   with the assistant's list: its quotes kept, plus her words as one line of hers when she typed.
 *
 * Words: copyV7form.ts (and reports/copy.ts); the rubric's levels and the bot's text are data.
 */

type MovesSection = Extract<DraftSection, { kind: "moves" }>;
type At = { at: "sections" } | { at: "section"; letter: string } | { at: "indicator"; letter: string; code: string };
const depthOf = (a: At) => (a.at === "indicator" ? 2 : a.at === "section" ? 1 : 0);
type Slot = { letter: string; code: string; label: string };

const LABEL = "text-[13px] font-bold text-[#6b7280]";

/** The first line of a block of the bot's text: its recording paragraph for one of the six. */
function oneLine(text: string): string {
  const paras = String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pick = paras.length > 1 ? paras[1] : paras[0] || "";
  return pick.split("\n")[0] || "";
}



/* ── one of the six: the Digital Coach can't count it ─────────────────────────────────────────────────────────── */

type Combined = Extract<V6Indicator, { kind: "combined" }>;

/**
 * bd-o15qnr.36 (#204, the operator 21 Nov ~14:20-14:30) — one of the six (C3 C5 C7 D2 D3 D4): what the recording found.
 * bd-o15qnr.39.1 (#204, the operator 22 Nov) — it is the "Digital Coach's evidence" box (the one title the eleven's box
 * has), holding only its findings: each snippet as an evidence row (time + quote, option B's look, read only); what it
 * said instead (D2's counts, N/A in the indicator's words, couldn't tell, starred) as one muted row. It heard nothing:
 * no box at all (never "Nothing for this in the recording"). What to look for and how to fill it are said once, in the
 * line under the indicator's name (no "You add: …"). An older bot sends only `body`: that text, in the same box.
 */
function SixEvidence({ ind, player }: { ind: Combined; player: LessonPlayer | null }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  const r = ind.recording;
  if (!r) {
    return ind.body ? (
      <DcEvidenceBox boxId="dc-box">
        <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-[#374151] [unicode-bidi:plaintext]" dir="auto" {...urduOf(ind.body)}>{ind.body}</p>
      </DcEvidenceBox>
    ) : null;
  }
  let what: ReactNode = null;
  if (r.state === "found" && r.found.length) {
    what = r.found.map((f, i) => (
      <DcQuoteRow key={`${f.time ?? ""}-${i}`} time={f.time} quote={f.quote} first={i === 0}
        chip={player && f.time ? <TimeChip time={f.time} rowKey={`${ind.id}-rec-${i}`} player={player} /> : undefined} />
    ));
  } else if (r.state === "d2" && r.turns) what = <DcNote text={F.d2Turns(r.turns.first, r.turns.second)} />;
  else if (r.state === "ie") what = <DcNote text={F.recIe} />;
  else if (r.state === "na") what = <DcNote text={r.naText || F.recNa} />;
  else if (r.state === "starred") what = <DcNote text={F.recStarred} />;
  return what ? <DcEvidenceBox boxId="dc-box">{what}</DcEvidenceBox> : null;
}

/* ── queue #251: the Digital Coach's evidence, once ───────────────────────────────────────────────────────────── */

/** One of the eleven: the Digital Coach's line and every quote with its time, read only (the box's one title). */
function DcEvidence({ ind, player }: { ind: Extract<V6Indicator, { kind: "dc" }>; player: LessonPlayer | null }) {
  const ev = ind.rumiEvidence;
  const because = (ev?.because ?? "").trim();
  const items = (ev?.items ?? []).filter((it) => it && String(it.quote ?? "").trim());
  if (!because && !items.length) return null;
  return (
    <DcEvidenceBox boxId="ff-evidence">
      {because ? (
        <p data-testid="ff-summary" className="m-0 py-1 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(because)}>{because}</p>
      ) : null}
      {items.map((it, i) => (
        <DcQuoteRow key={`${it.time ?? ""}-${i}`} time={it.time} quote={it.quote} first={i === 0 && !because}
          chip={player && it.time ? <TimeChip time={it.time} rowKey={`${ind.id}-${i}`} player={player} /> : undefined} />
      ))}
    </DcEvidenceBox>
  );
}

/* ── the form ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export type V6FormV7Props = {
  id: string;
  draft: ObservationDraft;
  values: Values;
  start: Values;
  setValues: Dispatch<SetStateAction<Values>>;
  readOnly: boolean;
  name: string;
  minReason: number;
  notes: readonly DraftObservationNote[];
  principal: boolean;
  /** B's moves, drawn as the paged form draws them. */
  moves: (s: MovesSection) => ReactNode;
  /** Out of the form (the observation page). */
  onLeave: () => void;
  /** The save: today's keys (values) and the evidence reviews by code (none: today's body). */
  onSave: (reviews: Record<string, EvidenceReview> | undefined) => void;
  confirm: boolean;
  setConfirm: (open: boolean) => void;
  saving: boolean;
  /** bd-o15qnr.38 — the save has had no answer for a few seconds (the tray says so). */
  slow?: boolean;
  problem: ReactNode;
  head: ReactNode;
};

export function V6FormV7({
  id, draft, values, start, setValues, readOnly, name, minReason, notes, principal, moves, onLeave, onSave, confirm, setConfirm, saving, slow = false, problem, head,
}: V6FormV7Props) {
  const C = useCopy(REPORTS) as ReportsCopy;
  const F = useCopy(FORM_V7) as FormV7Copy;
  const W7 = useCopy(FLOW_V7) as FlowV7Copy;
  const { toast, show, hide } = useFormToast();
  const [at, setAtNow] = useState<At>({ at: "sections" });
  const [shown, setShown] = useState<V6Problems>({});
  const focusNext = useRef<string | null>(null);
  // bd-o15qnr.48 (#244): each level deeper than every section is its own history entry, so the phone's Back steps up
  // one level like the arrow does (formLevels.ts). Every move goes through setAt; the phone's Back through the hook.
  const atNow = useRef(at);
  atNow.current = at;
  const levels = useFormLevels(depthOf(at), (d) => {
    setShown({});
    const cur = atNow.current;
    setAtNow(d <= 0 || cur.at === "sections" ? { at: "sections" } : d === 1 && cur.at === "indicator" ? { at: "section", letter: cur.letter } : cur);
  });
  const setAt = (next: At) => { levels.moved(depthOf(atNow.current), depthOf(next)); atNow.current = next; setAtNow(next); };

  const sections = useMemo(() => draft.sections.filter((s): s is MovesSection | V6Section => s.kind === "moves" || s.kind === "v6"), [draft]);
  const v6Indicators = useMemo(() => sections.flatMap((s) => (s.kind === "v6" ? s.indicators : [])), [sections]);
  const firstReviews = useMemo(() => {
    const out: Record<string, Review> = {};
    for (const ind of v6Indicators) { const r = initialReview(ind); if (r) out[ind.id] = r; }
    return out;
  }, [v6Indicators]);
  const kept = useMemo(() => (readOnly ? null : heldV7(id)), [id, readOnly]);
  const [reviews, setReviews] = useState<Record<string, Review>>(() => {
    const out = { ...firstReviews };
    if (kept) for (const code of Object.keys(out)) if (kept.reviews[code]) out[code] = kept.reviews[code];
    return out;
  });
  const [checked, setChecked] = useState<Set<string>>(() => new Set(kept ? kept.checked : []));
  // Queue #251: the indicators whose "Your evidence" box she opened (a box holding her words is open anyway).
  const [ownOpen, setOwnOpen] = useState<Set<string>>(() => new Set());

  // Kept on this phone with the values (formKeep.ts): what was agreed and how the evidence was checked.
  useEffect(() => {
    if (readOnly) { dropV7(id); return; }
    const changed = checked.size > 0 || Object.keys(reviews).some((c) => !sameReview(reviews[c], firstReviews[c]));
    if (changed) keepV7(id, checked, reviews); else dropV7(id);
  }, [id, readOnly, checked, reviews, firstReviews]);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    focusField(target);
  });
  // A new view starts at its top (unless a field is about to be focused).
  const where = at.at === "indicator" ? `${at.letter}:${at.code}` : at.at === "section" ? at.letter : "";
  useEffect(() => {
    if (!focusNext.current) document.getElementById("ff-top")?.scrollIntoView?.({ block: "start" });
  }, [where]);

  // Queue #251: the class recording plays from a Digital Coach time, under the evidence of the indicator on screen.
  const timed = !readOnly && v6Indicators.some((ind) => (ind.kind === "dc"
    ? (ind.rumiEvidence?.items ?? []).some((it) => !!it?.time)
    : (ind.recording?.found ?? []).some((f) => !!f?.time)));
  const { player, element: playerElement } = useLessonPlayer(id, timed, at.at === "indicator" ? `${at.letter}:${at.code}` : "");

  /* the rules, per indicator */
  const problemsOf = useCallback((sec: V6Section, ind: V6Indicator): V6Problems => {
    // bd-o15qnr.36: the note under one of the six is optional here (the server's portal save agrees)
    const all = v6Problems(sec, values, minReason, { whyOptional: true });
    const keys = [`r_${ind.field}`, `why_${ind.field}`];
    if (ind.kind === "combined" && ind.d2) keys.push("d2_children");
    if (changedFromRumi(ind, values)) keys.push(`chg_${sec.letter}`);
    const out: V6Problems = {};
    for (const k of keys) if (all[k]) out[k] = all[k];
    if (ind.kind === "dc" && !ind.options.some((o) => o.id === (values[`r_${ind.field}`] ?? ""))) out[`r_${ind.field}`] = "chooseLevel";
    return out;
  }, [values, minReason]);
  const doneWith = useCallback((sec: V6Section, ind: V6Indicator, agreed: Set<string>) => (
    readOnly || (Object.keys(problemsOf(sec, ind)).length === 0 && (ind.kind === "combined" || !!draft.saved || agreed.has(ind.id)))
  ), [readOnly, problemsOf, draft.saved]);
  const moveDone = (k: number) => readOnly || String(values[`fid_r_${k}`] ?? "").trim() !== "";

  const infoOf = (s: MovesSection | V6Section, agreed = checked) => {
    const flags = s.kind === "v6" ? s.indicators.map((ind) => doneWith(s, ind, agreed)) : s.moves.map((m) => moveDone(m.k));
    const done = flags.filter(Boolean).length;
    return { flags, done, total: flags.length, complete: done === flags.length };
  };
  const yellowWith = (agreed: Set<string>): Slot[] => sections.flatMap((s) => (s.kind === "v6"
    ? s.indicators.filter((ind) => !doneWith(s, ind, agreed)).map((ind) => ({ letter: s.letter, code: ind.id, label: F.nextToCheck(ind.id, ind.name) }))
    : s.moves.filter((m) => !moveDone(m.k)).map((m) => ({ letter: s.letter, code: `move-${m.k}`, label: F.nextToCheck(`${s.letter}${m.k}`, oneLine(m.plan)) }))));
  const yellow = yellowWith(checked);
  const left = sections.filter((s) => !infoOf(s).complete).length;

  /* where the form goes */
  const open = (slot: Slot) => {
    setShown({});
    if (slot.code.startsWith("move-")) { setAt({ at: "section", letter: slot.letter }); focusNext.current = `ff-${slot.code}`; return; }
    setAt({ at: "indicator", letter: slot.letter, code: slot.code });
  };
  const nextSlot = (letter: string, agreed: Set<string>): Slot | null => {
    const list = yellowWith(agreed);
    const i = sections.findIndex((s) => s.letter === letter);
    const order = [...sections.slice(i), ...sections.slice(0, i)].map((s) => s.letter);
    for (const l of order) { const hit = list.find((y) => y.letter === l); if (hit) return hit; }
    return null;
  };
  const back = () => {
    setShown({});
    if (at.at === "sections") onLeave();
    else levels.up();
  };

  /* the evidence */
  /*
   * Queue #251 — her own evidence. The Digital Coach's text is the bot's `rumiText` (an older bot: the box's text as the
   * form opened). Hers: the ev_ value whenever it is something else. Typed: ev_ is her words and the record adds them;
   * emptied, or "Keep the Digital Coach’s": ev_ goes back to the Digital Coach's text and the record to its quotes kept.
   */
  const dcTextOf = (ind: V6Indicator) => (ind.kind === "dc" && typeof ind.rumiText === "string" ? ind.rumiText : (start[`ev_${ind.field}`] ?? ""));
  const ownOf = (ind: V6Indicator) => {
    const v = values[`ev_${ind.field}`] ?? "";
    return v.trim() && v.trim() !== dcTextOf(ind).trim() ? v : "";
  };
  const keepDc = (ind: V6Indicator) => {
    const key = `ev_${ind.field}`;
    const first = firstReviews[ind.id];
    // the form opened on the Digital Coach's text: back to exactly how it opened (nothing changed); else to its text
    const opened = (start[key] ?? "").trim() === dcTextOf(ind).trim();
    setValues((cur) => ({ ...cur, [key]: opened ? (start[key] ?? "") : dcTextOf(ind) }));
    if (first) setReviews((cur) => ({ ...cur, [ind.id]: opened ? first : plainReview(first) }));
  };
  const typeOwn = (ind: V6Indicator, text: string) => {
    if (!text.trim()) { keepDc(ind); return; }
    const first = firstReviews[ind.id];
    setValues((cur) => ({ ...cur, [`ev_${ind.field}`]: text }));
    if (first) setReviews((cur) => ({ ...cur, [ind.id]: ownReview(first, text.trim()) }));
  };

  const gapToast = (p: V6Problems) => {
    const n = Object.keys(p).length;
    show(Object.values(p).every((v) => v === "chooseLevel") ? F.needLevel(n) : F.needAnswer(n));
  };
  const firstGap = (p: V6Problems, sec: V6Section, ind: V6Indicator): string | null => {
    if (p[`r_${ind.field}`]) return `lvl-${ind.field}`;
    if (p[`why_${ind.field}`]) return `why_${ind.field}`;
    if (p.d2_children) return "d2_children";
    if (p[`chg_${sec.letter}`]) return `chg_${sec.letter}`;
    return null;
  };

  const save = () => {
    if (yellow.length) {
      show(F.toCheck(yellow.length));
      const s = sections.find((x) => !infoOf(x).complete);
      if (s) focusField(`ff-sec-${s.letter}`);
      return;
    }
    setConfirm(true);
  };
  const doSave = () => {
    const out: Record<string, EvidenceReview> = {};
    for (const [code, r] of Object.entries(reviews)) out[code] = reviewOut(r);
    onSave(Object.keys(out).length ? out : undefined);
  };

  const crumbBase = name ? v7Crumb(W7, name, readOnly) : C.observation;
  const tray = (
    <SaveTrayV7 open={confirm} saving={saving} slow={slow} onSave={doSave} onClose={() => { if (!saving) setConfirm(false); }}
      counts={v7Changes(draft, start, values)} />
  );
  const frame = (crumb: string, dock: ReactNode, body: ReactNode) => (
    <ReportsFrame title={C.formTitle} crumb={crumb} onBack={back} dock={dock} testId="coach-feedback-form" dockSpace>
      <div id="ff-top" />
      {head}
      {body}
      <FormToast toast={toast} onDone={hide} />
      {tray}
    </ReportsFrame>
  );

  /* ── the outer view ── */
  if (at.at === "sections") {
    const dock = readOnly ? undefined : (
      <DockV7 single>
        <button type="button" onClick={save} aria-disabled={left > 0 || undefined}
          className={cn(PRIMARY_WIDE, left > 0 && "bg-[#e5e7eb] text-[#6b7280]", FOCUS)}>
          {left > 0 ? F.saveLeft(left) : C.saveForm}
        </button>
      </DockV7>
    );
    return frame(crumbBase, dock, (
      <>
        <FormChips label={draft.rubric?.label} />
        {readOnly && <p className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.readOnly}</p>}
        <SectionList items={sections.map((s) => ({ key: s.letter, title: `${s.letter}. ${s.title}`, info: infoOf(s) }))}
          onOpen={(letter) => { setShown({}); setAt({ at: "section", letter }); }} />
        {problem}
      </>
    ));
  }

  const sec = sections.find((s) => s.letter === at.letter) ?? sections[0];
  const chips = (
    <SectionChips items={sections.map((s) => ({ key: s.letter, short: s.letter, title: s.title, info: infoOf(s) }))} current={sec.letter}
      onOpen={(letter) => { setShown({}); setAt({ at: "section", letter }); }} />
  );

  /* ── a section ── */
  if (at.at === "section" || sec.kind === "moves") {
    const info = infoOf(sec);
    const next = nextSlot(sec.letter, checked);
    const dock = (
      <DockV7 single>
        {next
          ? <NextButton onClick={() => open(next)} label={next.label} />
          : <BottomButton onClick={() => setAt({ at: "sections" })}>{F.doneChecking}</BottomButton>}
      </DockV7>
    );
    return frame(crumbBase, dock, (
      <>
        {chips}
        <div data-testid="ff-section" className="flex flex-col gap-2.5">
          <SectionHead title={`${sec.letter}. ${sec.title}`} info={info} />
          {sec.kind === "moves" ? moves(sec) : (
            <>
              <V6Notes notes={notes} />
              <IndicatorRows>
                {sec.indicators.map((ind, i) => {
                  const options = v6RatingOptions(ind.options, C);
                  const level = values[`r_${ind.field}`] ?? "";
                  const words = level ? levelWords(options, level) : null;
                  const line = ind.kind === "dc" ? (reviews[ind.id]?.summary ?? oneLine(ind.evidence)) : oneLine(ind.recording?.lookFor || ind.body);
                  return (
                    <IndicatorRow key={ind.id} code={ind.id} name={ind.name} line={line} words={words} done={info.flags[i]} first={i === 0}
                      onOpen={() => open({ letter: sec.letter, code: ind.id, label: "" })} />
                  );
                })}
              </IndicatorRows>
            </>
          )}
        </div>
        {problem}
      </>
    ));
  }

  /* ── one indicator ── */
  const list = sec.indicators;
  const index = Math.max(0, list.findIndex((x) => x.id === at.code));
  const ind = list[index];
  const rk = `r_${ind.field}`;
  const options = v6RatingOptions(ind.options, C);
  const why = (k: string) => problemText(C, shown[k], minReason);
  const go = (n: number) => { setShown({}); setAt({ at: "indicator", letter: sec.letter, code: list[n].id }); };
  const agree = () => {
    const p = problemsOf(sec, ind);
    setShown(p);
    if (Object.keys(p).length) {
      gapToast(p);
      focusNext.current = firstGap(p, sec, ind);
      return;
    }
    const agreed = new Set(checked).add(ind.id);
    setChecked(agreed);
    const after = [...list.slice(index + 1), ...list.slice(0, index)].find((x) => !doneWith(sec, x, agreed));
    setShown({});
    if (after) setAt({ at: "indicator", letter: sec.letter, code: after.id });
    else setAt({ at: "section", letter: sec.letter });
  };
  const review = reviews[ind.id];
  const dcShown = ind.kind === "dc" && (!!(ind.rumiEvidence?.because ?? "").trim() || (ind.rumiEvidence?.items ?? []).some((it) => !!String(it?.quote ?? "").trim()));
  const crumb = F.indicatorCrumb(name || C.formTitle, sec.letter, index + 1, list.length);
  const dock = readOnly ? undefined : (
    <DockV7 single><BottomButton onClick={agree}>{F.agreeNext}</BottomButton></DockV7>
  );
  const levelBlock = readOnly
    ? (values[rk] ? <StatusChip text={levelWords(options, values[rk]) || C.dash} tone="info" className="self-start" /> : null)
    : (
      <div id={`lvl-${ind.field}`} className="flex flex-col gap-1">
        <Levels name={ind.name} value={values[rk] || ""} options={options} dc={ind.kind === "dc" ? ind.rumi : null} onChange={(v) => setValues((cur) => ({ ...cur, [rk]: v }))} />
        <Problem text={why(rk)} />
      </div>
    );
  const set = (k: string) => (v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  const chgKey = `chg_${sec.letter}`;
  const about = ind.about || (ind.kind === "combined" ? ind.recording?.lookFor : "") || "";

  return frame(crumb, dock, (
    <section data-testid="ff-indicator" className="flex flex-col gap-2.5">
      {/* bd-o15qnr.35 (the operator 21 Nov ~12:58: "See that empty space up above? Maybe keep the indicator name there?"):
          the code and the name between Previous and Next (two lines at most), not again inside the card. */}
      <IndicatorNav code={ind.id} name={ind.name} index={index} count={list.length} onGo={go} />
      {/* bd-o15qnr.37 (the operator 22 Nov ~00:15): what the indicator looks at, one muted line under its name */}
      {/* bd-o15qnr.39.1: one of the six also says how to fill it (`hint`); an older bot without the line: its look-for */}
      {about ? <AboutLine text={about} hint={ind.kind === "combined" ? ind.hint : null} rubric={draft.rubric?.id || "fico17_v6"} code={ind.id} /> : null}
      <div data-testid="ff-card" className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
        {/* bd-o15qnr.36: no legend on one of the six (no Digital Coach level there); a short line on top instead.
            bd-o15qnr.39.1: the line stays on the six only, where the Digital Coach gives no level. */}
        {!readOnly && ind.kind === "dc" && <Legend principal={principal} />}
        {!readOnly && ind.kind === "combined" && (
          <p data-testid="cant-count" className="m-0 flex items-start gap-2 px-1 text-[14px] font-semibold leading-snug text-[#33374a]" dir="auto">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#6e52e0]" aria-hidden="true" />
            <span>{F.cantCount}</span>
          </p>
        )}
        {ind.kind === "dc" && !readOnly && changedFromRumi(ind, values) && (
          <StatusChip text={F.changedFrom(levelWords(options, ind.rumi) || C.dash)} tone="waiting" className="self-start" />
        )}
        {ind.kind === "combined" ? (
          <>
            <SixEvidence ind={ind} player={player} />
            {playerElement}
            {levelBlock}
            <TextBox id={`why_${ind.field}`} label={F.noteOptional} value={values[`why_${ind.field}`] ?? ""}
              onChange={set(`why_${ind.field}`)} readOnly={readOnly} problem={why(`why_${ind.field}`)} />
            {ind.d2 && (
              readOnly ? (
                <p className="m-0 text-[15px]">{`${C.d2Children}: ${values.d2_children || C.dash} · ${C.d2QuietLater}: ${values.d2_quiet_later || C.dash}`}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className={cn(GRID, "grid-cols-2 gap-2.5")}>
                    {([["d2_children", C.d2Children], ["d2_quiet_later", C.d2QuietLater]] as const).map(([k, label]) => (
                      <div key={k} className="flex flex-col gap-1">
                        <label htmlFor={k} className={LABEL}>{label}</label>
                        <input id={k} dir="auto" inputMode="numeric" pattern="[0-9]*" value={values[k] ?? ""} onChange={(e) => set(k)(e.target.value)}
                          aria-invalid={shown.d2_children ? true : undefined}
                          className={cn("min-h-[56px] w-full rounded-xl border border-[#d1d5db] bg-white px-3 text-[18px] font-semibold tabular-nums", FOCUS, shown.d2_children && "border-[#c8331f]")} />
                      </div>
                    ))}
                  </div>
                  <Problem text={why("d2_children")} />
                </div>
              )
            )}
          </>
        ) : (
          <>
            {levelBlock}
            {(changedFromRumi(ind, values) && !readOnly) || (readOnly && values[chgKey]) ? (
              <div data-testid="why-changed" className="flex flex-col gap-2.5 rounded-2xl border border-[#fde7b0] bg-[#fffbeb] p-3">
                {/* bd-o15qnr.40.8: its minimum counted live; too short says so with the count, after Agree or leaving it */}
                <TextBox id={chgKey} label={F.whyChanged} value={values[chgKey] ?? ""} readOnly={readOnly}
                  onChange={(v) => { set(chgKey)(v); setShown((cur) => { if (!cur[chgKey]) return cur; const next = { ...cur }; delete next[chgKey]; return next; }); }}
                  onBlur={() => { if (minReason > 0 && Array.from((values[chgKey] ?? "").trim()).length < minReason) setShown((cur) => ({ ...cur, [chgKey]: "atLeast" })); }}
                  problem={shown[chgKey] === "atLeast" ? F.tooShort(Array.from((values[chgKey] ?? "").trim()).length, minReason) : why(chgKey)}
                  hint={readOnly || minReason <= 0 ? null : (
                    <span data-testid="char-count" className={cn("px-1 text-[13px] tabular-nums", Array.from((values[chgKey] ?? "").trim()).length >= minReason ? "text-[#2f7a52]" : "text-[#6b7280]")}>
                      {F.charCount(Array.from((values[chgKey] ?? "").trim()).length, minReason)}
                    </span>
                  )} />
              </div>
            ) : null}
            {/* queue #251: the Digital Coach's evidence once, the player under it, then her own box (empty until she types) */}
            {review && !readOnly && dcShown ? (
              <>
                <DcEvidence ind={ind} player={player} />
                {playerElement}
                <OwnEvidence id={`ev_${ind.field}`} open={ownOpen.has(ind.id) || !!ownOf(ind)} value={ownOf(ind)} readOnly={false}
                  onOpen={() => { setOwnOpen((cur) => new Set(cur).add(ind.id)); focusNext.current = `ev_${ind.field}`; }}
                  onChange={(v) => typeOwn(ind, v)}
                  onKeep={() => { setOwnOpen((cur) => { const next = new Set(cur); next.delete(ind.id); return next; }); keepDc(ind); }} />
              </>
            ) : <TextBox id={`ev_${ind.field}`} label={F.evidence} value={values[`ev_${ind.field}`] ?? ""} onChange={set(`ev_${ind.field}`)} readOnly={readOnly} />}
            <TextBox id={`imp_${ind.field}`} label={C.toImprove} value={values[`imp_${ind.field}`] ?? ""} onChange={set(`imp_${ind.field}`)} readOnly={readOnly} />
          </>
        )}
      </div>
      {readOnly ? (
        <button type="button" onClick={back} className={cn(OUTLINE_WIDE, FOCUS)}>{F.doneChecking}</button>
      ) : null}
    </section>
  ));
}
