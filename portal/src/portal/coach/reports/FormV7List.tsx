import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Check, ChevronLeft, ChevronRight, Info, MoreHorizontal, Pause, Pencil, Play, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach } from "../../services/api";
import type { DraftSection, EvidenceReview, ObservationDraft, V6Indicator } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui";
import { CHEVRON, FOCUS, GRID, LIST_CARD, OUTLINE_WIDE, PRIMARY_WIDE, ROW_DIVIDER } from "../../teacher/ui/styles";
import { BottomButton } from "../ui";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FORM_V7, type FormV7Copy } from "../flow/copyV7form";
import ReportsFrame from "./ReportsFrame";
import { REPORTS, type ReportsCopy } from "./copy";
import type { Values } from "./formModel";
import {
  AutoText, DockV7, FormChips, FormToast, Legend, Levels, PartTitle, ReadOnlyBox, SaveTrayV7, TextBox, UNDO_MS, focusField,
  levelWords, urduOf, useFormToast, v7Changes, v7Crumb,
} from "./FormV7";
import { Problem, problemText, v6RatingOptions } from "./V6Parts";
import { changedFromRumi, v6Problems, type V6Problems, type V6Section } from "./v6Model";
import {
  addRow, clockSeconds, dropV7, editRow, evText, heldV7, initialReview, keepV7, normClock, removeRow, reviewOut, sameReview, setSummary, shownRows,
  type Review, type ReviewRow,
} from "./evidenceReview";

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
 *   evidence (B)    the assistant's summary (pencil → a box sized to its text, Done) and each {time, quote} as a row:
 *                   a time chip (plays the lesson from there when the recording is on this page), the quote (Urdu
 *                   right to left in Nastaliq), ⋯ → Edit (in place, the time stays, an "edited" tag) / Remove (the toast
 *                   "Quote removed · Undo" for 5 s). "Add evidence" adds the coach's own line (what you saw, an optional
 *                   mm:ss time) with a dark "You" tag. No assistant list (an older bot): today's one Evidence box.
 *   saved           the same keys as today (ev_<code> one text: evidenceReview.ts evText; an evidence left as it came
 *                   keeps the server's own text), plus `evidence_review` per indicator that has the assistant's list.
 *
 * The time chip: one recording per visit (the portal joins its chunks into ONE file, lib/lessonRecorder.ts; WhatsApp
 * sends one audio), and the assistant's MM:SS are read off that file's transcript, so its clock is the file's. The
 * recording's link comes from GET /coach/observation/:id (as the visit page plays it); without it the time is a plain
 * chip. Words: copyV7form.ts (and reports/copy.ts); the rubric's levels and the bot's text are data.
 */

type MovesSection = Extract<DraftSection, { kind: "moves" }>;
type At = { at: "sections" } | { at: "section"; letter: string } | { at: "indicator"; letter: string; code: string };
type Slot = { letter: string; code: string; label: string };

const LABEL = "text-[13px] font-bold text-[#6b7280]";
const GREEN = "bg-[#48b078]";
const YELLOW = "bg-[#f5c542]";

/** The first line of a block of the bot's text: its recording paragraph for one of the six. */
function oneLine(text: string): string {
  const paras = String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pick = paras.length > 1 ? paras[1] : paras[0] || "";
  return pick.split("\n")[0] || "";
}

/** A green tick or a yellow dot; the words for a screen reader come from the row. */
function Mark({ done, size = 22 }: { done: boolean; size?: number }) {
  return (
    <span aria-hidden="true" data-mark={done ? "done" : "todo"} style={{ width: size, height: size }}
      className={cn("flex shrink-0 items-center justify-center rounded-full text-white", done ? GREEN : YELLOW)}>
      {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

const SR = "sr-only";

/* ── the recording ────────────────────────────────────────────────────────────────────────────────────────────── */

type Audio = { url: string; playing: string | null; play: (key: string, time: string) => void };

function useLessonAudio(id: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!enabled || !id) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => coach.getObservation(id))
      .then((r) => { if (live) setUrl(r && typeof r.audioUrl === "string" && r.audioUrl ? r.audioUrl : null); })
      .catch(() => { /* no recording link: the times stay plain chips */ });
    return () => { live = false; };
  }, [id, enabled]);
  const play = useCallback((key: string, time: string) => {
    const el = ref.current;
    const at = clockSeconds(time);
    if (!el || at === null) return;
    if (playing === key && !el.paused) { el.pause(); setPlaying(null); return; }
    try { el.currentTime = at; } catch { /* not seekable yet: it plays from where it is */ }
    setPlaying(key);
    Promise.resolve(el.play()).catch(() => setPlaying(null));
  }, [playing]);
  const element = url ? (
    <audio ref={ref} data-testid="ff-audio" src={url} preload="none" className="hidden"
      onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} />
  ) : null;
  const audio: Audio | null = url ? { url, playing, play } : null;
  return { audio, element };
}

function TimeChip({ time, rowKey, audio }: { time: string | null; rowKey: string; audio: Audio | null }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  if (!time) return null;
  const chip = "inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#eef0ff] px-2.5 text-[13px] font-bold tabular-nums text-[#3b3fb0]";
  if (!audio || clockSeconds(time) === null) return <span data-testid="ff-time" dir="ltr" className={chip}>{time}</span>;
  const on = audio.playing === rowKey;
  return (
    <button type="button" onClick={() => audio.play(rowKey, time)} aria-pressed={on} aria-label={on ? F.pauseAt(time) : F.playAt(time)}
      className={cn("flex min-h-[56px] shrink-0 items-center", FOCUS)}>
      <span dir="ltr" className={chip}>
        {on ? <Pause className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
        {time}
      </span>
    </button>
  );
}

/* ── one of the six: the Digital Coach can't count it ─────────────────────────────────────────────────────────── */

type Combined = Extract<V6Indicator, { kind: "combined" }>;

/**
 * bd-o15qnr.36 (#204, the operator 21 Nov ~14:20-14:30) — the "From the recording" box of one of the six (C3 C5 C7 D2
 * D3 D4): what to look for; any snippets the recording did find as evidence rows (time + quote, option B's look, read
 * only); else "Nothing for this in the recording" in muted words (or why: couldn't show, N/A, starred; D2's counts);
 * then "You add: …" (no rubric "written justification"). An older bot sends only `body`: today's box.
 */
function RecordingBox({ ind, audio }: { ind: Combined; audio: Audio | null }) {
  const C = useCopy(REPORTS) as ReportsCopy;
  const F = useCopy(FORM_V7) as FormV7Copy;
  const r = ind.recording;
  if (!r) return ind.body ? <div data-testid="from-recording"><ReadOnlyBox label={C.fromRecording} text={ind.body} /></div> : null;
  const MUTED = "m-0 py-1 text-[14px] leading-relaxed text-[#6b7280] [unicode-bidi:plaintext]";
  const note = (text: string) => <p data-testid="rec-note" className={MUTED} dir="auto">{text}</p>;
  let what: ReactNode;
  if (r.state === "found" && r.found.length) {
    what = r.found.map((f, i) => (
      <div key={`${f.time ?? ""}-${i}`} data-testid="rec-row" className={cn("flex items-start gap-2 py-1", ROW_DIVIDER)}>
        <TimeChip time={f.time} rowKey={`${ind.id}-rec-${i}`} audio={audio} />
        <span className="min-w-0 flex-1 py-1 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(f.quote)}>{`“${f.quote}”`}</span>
      </div>
    ));
  } else if (r.state === "d2" && r.turns) {
    what = <p data-testid="rec-note" className="m-0 py-1 text-[15px] leading-relaxed text-[#1d2025]" dir="auto">{F.d2Turns(r.turns.first, r.turns.second)}</p>;
  } else if (r.state === "ie") what = note(F.recIe);
  else if (r.state === "na") what = note(r.naText || F.recNa);
  else if (r.state === "starred") what = note(F.recStarred);
  else what = <p data-testid="rec-nothing" className={MUTED} dir="auto">{F.nothingInRecording}</p>;
  return (
    <div data-testid="from-recording" className="flex flex-col gap-1">
      <span className={LABEL}>{C.fromRecording}</span>
      <div className="flex flex-col gap-1 rounded-2xl border border-[#e5e7eb] bg-[#fafafb] px-3 py-2.5">
        {r.lookFor ? <p className="m-0 pb-1 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(r.lookFor)}>{r.lookFor}</p> : null}
        {what}
        {r.youAdd ? <p className={cn("m-0 pt-2 text-[14px] leading-relaxed text-[#374151] [unicode-bidi:plaintext]", ROW_DIVIDER)} dir="auto" {...urduOf(r.youAdd)}>{F.youAdd(r.youAdd)}</p> : null}
      </div>
    </div>
  );
}

/* ── the evidence, option B with editing ──────────────────────────────────────────────────────────────────────── */

function EvidenceBox({ code, review, onChange, onRemove, audio }: {
  code: string; review: Review; onChange: (r: Review) => void; onRemove: (key: string) => void; audio: Audio | null;
}) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const [adding, setAdding] = useState<{ text: string; time: string; bad: boolean } | null>(null);

  const row = (r: ReviewRow, first: boolean) => {
    const mine = r.source === "coach";
    const text = mine ? r.text : r.status === "edited" ? r.coachText ?? r.quote : r.quote;
    const isEditing = editing?.key === r.key;
    return (
      <div key={r.key} data-testid="ff-quote" data-source={r.source} data-status={mine ? undefined : r.status}
        className={cn("flex flex-col gap-1.5 py-1.5", !first && ROW_DIVIDER)}>
        <div className="flex items-start gap-2">
          {mine ? <span className="mt-4 inline-flex h-6 shrink-0 items-center rounded-full bg-[#33374a] px-2.5 text-[12px] font-bold text-white">{F.you}</span> : null}
          <TimeChip time={r.time} rowKey={r.key} audio={audio} />
          {isEditing ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
              <AutoText aria-label={F.edit} value={editing.text} onChange={(e) => setEditing({ key: r.key, text: e.target.value })}
                className={cn("w-full rounded-xl border border-[#d1d5db] bg-white px-3 py-2.5 text-[16px] leading-snug", FOCUS)} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className={cn("min-h-[56px] rounded-xl border border-[#d1d5db] bg-white px-4 text-[14px] font-semibold text-[#33374a]", FOCUS)}>{F.cancel}</button>
                <button type="button" onClick={() => { onChange(editRow(review, r.key, editing.text)); setEditing(null); }}
                  className={cn("min-h-[56px] rounded-xl bg-[#33374a] px-4 text-[14px] font-semibold text-white", FOCUS)}>{F.done}</button>
              </div>
            </div>
          ) : (
            <span className="min-w-0 flex-1 py-3.5 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(text)}>
              {mine ? text : `“${text}”`}
            </span>
          )}
          {!isEditing && !mine && r.status === "edited" ? <span className="mt-4 shrink-0 rounded-full bg-[#f3f4f6] px-2 text-[11.5px] font-bold leading-6 text-[#6b7280]">{F.edited}</span> : null}
          {!isEditing ? (
            <button type="button" aria-label={F.more} aria-expanded={menu === r.key} onClick={() => setMenu(menu === r.key ? null : r.key)}
              className={cn("flex h-14 w-11 shrink-0 items-center justify-center rounded-xl text-[#6b7280]", FOCUS)}>
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {menu === r.key ? (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setMenu(null); setEditing({ key: r.key, text }); }}
              className={cn("min-h-[56px] rounded-xl border border-[#d1d5db] bg-white px-4 text-[15px] font-semibold text-[#33374a]", FOCUS)}>{F.edit}</button>
            <button type="button" onClick={() => { setMenu(null); onRemove(r.key); }}
              className={cn("min-h-[56px] rounded-xl border border-[#e5e7eb] bg-white px-4 text-[15px] font-semibold text-[#c8331f]", FOCUS)}>{F.remove}</button>
          </div>
        ) : null}
      </div>
    );
  };

  const add = () => {
    if (!adding || !adding.text.trim()) return;
    const raw = adding.time.trim();
    const time = raw ? normClock(raw) : null;
    if (raw && !time) { setAdding({ ...adding, bad: true }); return; }
    onChange(addRow(review, adding.text.trim(), time));
    setAdding(null);
  };

  const rows = shownRows(review);
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{F.evidence}</span>
      <div data-testid="ff-evidence" className="flex flex-col gap-1 rounded-2xl border border-[#e5e7eb] bg-[#fafafb] px-3 py-2.5">
        <span className="text-[12px] font-bold uppercase tracking-wide text-[#6e52e0]">{F.assistantHeard}</span>
        {summaryOpen ? (
          <div className="flex flex-col gap-1.5">
            <AutoText aria-label={F.editSummary} value={review.summary} onChange={(e) => onChange(setSummary(review, e.target.value))}
              className={cn("w-full rounded-xl border border-[#d1d5db] bg-white px-3 py-2.5 text-[16px] leading-snug", FOCUS)} />
            <button type="button" onClick={() => setSummaryOpen(false)}
              className={cn("min-h-[56px] self-end rounded-xl border border-[#d1d5db] bg-white px-4 text-[14px] font-semibold text-[#33374a]", FOCUS)}>{F.done}</button>
          </div>
        ) : (
          <div className="flex items-start gap-1.5">
            <p data-testid="ff-summary" className="m-0 min-w-0 flex-1 py-3 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(review.summary)}>{review.summary}</p>
            <button type="button" aria-label={F.editSummary} onClick={() => setSummaryOpen(true)}
              className={cn("flex h-14 w-11 shrink-0 items-center justify-center rounded-xl text-[#6b7280]", FOCUS)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {rows.map((r, i) => row(r, i === 0 && !review.summary))}
        {adding ? (
          <div className={cn("flex flex-col gap-2 py-2.5", ROW_DIVIDER)}>
            <label htmlFor={`ff-add-${code}`} className={LABEL}>{F.whatYouSaw}</label>
            <AutoText id={`ff-add-${code}`} value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })}
              className={cn("w-full rounded-xl border border-[#d1d5db] bg-white px-3 py-2.5 text-[16px] leading-snug", FOCUS)} />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`ff-add-time-${code}`} className={LABEL}>{F.timeOptional}</label>
              <input id={`ff-add-time-${code}`} dir="auto" inputMode="text" value={adding.time} aria-invalid={adding.bad || undefined}
                onChange={(e) => setAdding({ ...adding, time: e.target.value, bad: false })}
                className={cn("h-14 w-[88px] rounded-xl border border-[#d1d5db] bg-white px-2 text-center text-[16px] tabular-nums", adding.bad && "border-[#c8331f]", FOCUS)} />
              <span className="flex-1" />
              <button type="button" onClick={() => setAdding(null)} className={cn("min-h-[56px] rounded-xl border border-[#d1d5db] bg-white px-4 text-[14px] font-semibold text-[#33374a]", FOCUS)}>{F.cancel}</button>
              <button type="button" onClick={add} disabled={!adding.text.trim()}
                className={cn("min-h-[56px] rounded-xl bg-[#33374a] px-4 text-[14px] font-semibold text-white disabled:opacity-50", FOCUS)}>{F.add}</button>
            </div>
            <Problem text={adding.bad ? F.timeFormat : null} />
          </div>
        ) : (
          <button type="button" onClick={() => setAdding({ text: "", time: "", bad: false })}
            className={cn("flex min-h-[56px] items-center gap-2 text-[15px] font-semibold text-[#33374a]", ROW_DIVIDER, FOCUS)}>
            <Plus className="h-4 w-4" aria-hidden="true" />{F.addEvidence}
          </button>
        )}
      </div>
    </div>
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
  problem: ReactNode;
  head: ReactNode;
};

export function V6FormV7({
  id, draft, values, start, setValues, readOnly, name, minReason, principal, moves, onLeave, onSave, confirm, setConfirm, saving, problem, head,
}: V6FormV7Props) {
  const C = useCopy(REPORTS) as ReportsCopy;
  const F = useCopy(FORM_V7) as FormV7Copy;
  const W7 = useCopy(FLOW_V7) as FlowV7Copy;
  const { toast, show, hide } = useFormToast();
  const [at, setAt] = useState<At>({ at: "sections" });
  const [shown, setShown] = useState<V6Problems>({});
  const focusNext = useRef<string | null>(null);

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

  const timed = !readOnly && Object.values(reviews).some((r) => r.rows.some((row) => !!row.time));
  const { audio, element: audioElement } = useLessonAudio(id, timed);

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
    if (at.at === "indicator") setAt({ at: "section", letter: at.letter });
    else if (at.at === "section") setAt({ at: "sections" });
    else onLeave();
  };

  /* the evidence */
  const changeReview = (code: string, next: Review) => {
    setReviews((cur) => ({ ...cur, [code]: next }));
    const key = `ev_${code}`;
    setValues((cur) => ({ ...cur, [key]: sameReview(next, firstReviews[code]) ? (start[key] ?? "") : evText(next) }));
  };
  const removeQuote = (code: string, key: string) => {
    const before = reviews[code];
    changeReview(code, removeRow(before, key));
    show(F.quoteRemoved, UNDO_MS, { label: F.undo, run: () => changeReview(code, before) });
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
    <SaveTrayV7 open={confirm} saving={saving} onSave={doSave} onClose={() => { if (!saving) setConfirm(false); }}
      counts={v7Changes(draft, start, values)} />
  );
  const frame = (crumb: string, dock: ReactNode, body: ReactNode) => (
    <ReportsFrame title={C.formTitle} crumb={crumb} onBack={back} dock={dock} testId="coach-feedback-form">
      <div id="ff-top" />
      {head}
      {body}
      {audioElement}
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
        <div data-testid="ff-sections" className="flex flex-col gap-2.5">
          {sections.map((s) => {
            const info = infoOf(s);
            return (
              <button key={s.letter} id={`ff-sec-${s.letter}`} type="button" onClick={() => { setShown({}); setAt({ at: "section", letter: s.letter }); }}
                className={cn(LIST_CARD, "flex min-h-[64px] w-full items-center gap-3 px-3.5 text-start", FOCUS)}>
                <Mark done={info.complete} size={16} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
                  <span className="text-[16px] font-semibold leading-[1.3]" dir="auto">{`${s.letter}. ${s.title}`}</span>
                  <span className="text-[13px] leading-[1.3] text-[#6b7280]">{F.doneOf(info.done, info.total)}</span>
                </span>
                <span className={SR}>{info.complete ? F.markDone : F.markTodo}</span>
                <ChevronRight className={cn("h-5 w-5", CHEVRON)} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {problem}
      </>
    ));
  }

  const sec = sections.find((s) => s.letter === at.letter) ?? sections[0];
  const chips = (
    <div data-testid="ff-chips" className={cn(GRID, "grid-cols-4 gap-1.5")}>
      {sections.map((s) => {
        const info = infoOf(s);
        const on = s.letter === sec.letter;
        return (
          <button key={s.letter} type="button" data-mark={info.complete ? "done" : "todo"} aria-current={on ? true : undefined}
            aria-label={`${s.letter} ${info.done}/${info.total}, ${info.complete ? F.markDone : F.markTodo}`}
            onClick={() => { setShown({}); setAt({ at: "section", letter: s.letter }); }}
            className={cn("flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl border text-[13px] font-bold",
              info.complete ? "border-[#48b078] bg-[#eaf6ef] text-[#1f5f3d]" : "border-[#f5c542] bg-[#fff7d6] text-[#7a5b00]",
              on && "shadow-[0_0_0_2px_#33374a]", FOCUS)}>
            {s.letter}
            <small dir="ltr" className="text-[11px] font-semibold opacity-90">{`${info.done}/${info.total}`}</small>
          </button>
        );
      })}
    </div>
  );

  /* ── a section ── */
  if (at.at === "section" || sec.kind === "moves") {
    const info = infoOf(sec);
    const next = nextSlot(sec.letter, checked);
    const dock = (
      <DockV7 single>
        {next
          ? <BottomButton onClick={() => { show(F.toCheck(yellow.length)); open(next); }}>{next.label}</BottomButton>
          : <BottomButton onClick={() => setAt({ at: "sections" })}>{F.doneChecking}</BottomButton>}
      </DockV7>
    );
    return frame(crumbBase, dock, (
      <>
        {chips}
        <div data-testid="ff-section" className="flex flex-col gap-2.5">
          <PartTitle text={`${sec.letter}. ${sec.title}`} />
          <span className="px-1 text-[13px] font-bold text-[#6b7280]">{F.checkedOf(info.done, info.total)}</span>
          {info.total > 0 ? (
            <div aria-hidden="true" className="flex gap-[3px] px-1">
              {info.flags.map((f, i) => <i key={i} className={cn("h-1.5 flex-1 rounded-[3px]", f ? GREEN : "bg-[#e5e7eb]")} />)}
            </div>
          ) : null}
          {sec.kind === "moves" ? moves(sec) : (
            <>
              <section className={LIST_CARD}>
                {sec.indicators.map((ind, i) => {
                  const done = info.flags[i];
                  const options = v6RatingOptions(ind.options, C);
                  const level = values[`r_${ind.field}`] ?? "";
                  const words = level ? levelWords(options, level) : null;
                  const line = ind.kind === "dc" ? (reviews[ind.id]?.summary ?? oneLine(ind.evidence)) : oneLine(ind.recording?.lookFor || ind.body);
                  return (
                    <button key={ind.id} type="button" data-testid="ff-row" onClick={() => open({ letter: sec.letter, code: ind.id, label: "" })}
                      className={cn("flex min-h-[68px] w-full items-center gap-2.5 px-3.5 py-2 text-start", i > 0 && ROW_DIVIDER, FOCUS)}>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="inline-flex h-6 min-w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[#e8e9f0] px-1.5 text-[12px] font-bold text-[#33374a]">{ind.id}</span>
                          <span className="min-w-0 truncate text-[15px] font-semibold leading-[1.3]" dir="auto">{ind.name}</span>
                        </span>
                        {line ? <span className="truncate text-[13px] text-[#6b7280]" dir="auto" {...urduOf(line)}>{line}</span> : null}
                      </span>
                      {words ? <StatusChip text={words} tone="info" /> : <StatusChip text={F.yoursToSet} tone="waiting" />}
                      <span className="order-first"><Mark done={done} /></span>
                      <span className={SR}>{done ? F.markDone : F.markTodo}</span>
                      <ChevronRight className={cn("h-5 w-5", CHEVRON)} aria-hidden="true" />
                    </button>
                  );
                })}
              </section>
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

  return frame(crumb, dock, (
    <section data-testid="ff-indicator" className="flex flex-col gap-2.5">
      {/* bd-o15qnr.35 (the operator 21 Nov ~12:58: "See that empty space up above? Maybe keep the indicator name there?"):
          the code and the name between Previous and Next (two lines at most), not again inside the card. */}
      <div data-testid="ff-nav" className="flex items-center gap-2">
        <button type="button" aria-label={F.prevIndicator} disabled={index === 0} onClick={() => go(index - 1)}
          className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-[#33374a] disabled:opacity-40", FOCUS)}>
          <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <StatusChip text={ind.id} tone="score" className="shrink-0" />
          <h3 className="m-0 line-clamp-2 min-w-0 flex-1 text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]" dir="auto">{ind.name}</h3>
        </div>
        <button type="button" aria-label={F.nextIndicator} disabled={index >= list.length - 1} onClick={() => go(index + 1)}
          className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-[#33374a] disabled:opacity-40", FOCUS)}>
          <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </button>
      </div>
      <div data-testid="ff-card" className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
        {/* bd-o15qnr.36: no legend on one of the six (no Digital Coach level there); a short line on top instead */}
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
            <RecordingBox ind={ind} audio={audio} />
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
                <TextBox id={chgKey} label={F.whyChanged} value={values[chgKey] ?? ""} onChange={set(chgKey)} readOnly={readOnly} problem={why(chgKey)} />
              </div>
            ) : null}
            {review && !readOnly
              ? <EvidenceBox code={ind.id} review={review} audio={audio} onChange={(r) => changeReview(ind.id, r)} onRemove={(key) => removeQuote(ind.id, key)} />
              : <TextBox id={`ev_${ind.field}`} label={F.evidence} value={values[`ev_${ind.field}`] ?? ""} onChange={set(`ev_${ind.field}`)} readOnly={readOnly} />}
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
