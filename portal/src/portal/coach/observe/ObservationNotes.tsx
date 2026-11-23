import { useId, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { DraftObservationNote, ObserveNote } from "../../services/api";
import { useLang } from "../../teacher/i18n";
import { FOCUS } from "../../teacher/ui/styles";
import { NOTE_CAP } from "../observeDraft";
import { noteClock } from "./format";

/**
 * bd-ra8xu.60 (queue #127) — Observation Notes, the coach's own lines about what the recording cannot hear (the board,
 * group work, who stayed quiet), shown the same way on Record, on Check and send and at the top of each FICO17 v6 part
 * of the Feedback Form: one per line, the recording clock first (a small flat chip, never tappable) when it was typed
 * while recording. The text is DATA, shown word for word. In Urdu the clock is Urdu digits in an LTR isolate.
 *
 * AddNote is the one way to add one: a box and an Add button (56px), the box emptied once added. What is kept (trimmed,
 * capped, stamped) is the caller's: observeDraft.withTyped.
 */

/** A note as it is shown: its words and the recording clock it was typed at, if any. */
export const shownNote = (n: ObserveNote): DraftObservationNote => ({ text: n.text, recTime: n.rec_time || null });

export function NotesList({ notes }: { notes: readonly DraftObservationNote[] }) {
  const lang = useLang();
  if (!notes.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {notes.map((n, i) => (
        <li key={`${i}:${n.recTime ?? ""}:${n.text.slice(0, 24)}`} data-testid="observation-note" className="flex items-start gap-2.5">
          {n.recTime && (
            <span data-testid="note-clock" dir="ltr"
              className="inline-flex h-[26px] shrink-0 items-center rounded-full bg-[#f3f4f6] px-2.5 text-[13px] font-semibold tabular-nums text-[#374151]">
              {noteClock(n.recTime, lang)}
            </span>
          )}
          <span dir="auto" className="min-w-0 flex-1 whitespace-pre-line break-words pt-0.5 text-[16px] leading-snug text-[#1d2025]">{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

const FIELD = "w-full rounded-xl border border-[#d1d5db] bg-white px-3 text-[16px] leading-snug text-[#1d2025]";

/**
 * The box and its Add. One line (Record: the label is the card's title, `placeholder` the prompt; Enter adds) or a few
 * lines (`multiline`, Check and send: the label shows above it).
 */
export function AddNote({ label, placeholder, addLabel, multiline = false, onAdd }: {
  label: string; placeholder?: string; addLabel: string; multiline?: boolean; onAdd: (typed: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd(value);
    setValue("");
  };
  const add = (
    <button type="submit"
      className={cn("flex h-14 shrink-0 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white px-5 text-base font-semibold text-[#1d2025]", FOCUS)}>
      {addLabel}
    </button>
  );
  if (multiline) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={id} className="text-[15px] font-semibold text-[#4b5563]">{label}</label>
        <textarea id={id} value={value} rows={3} dir="auto" placeholder={placeholder} onChange={(e) => setValue(e.target.value)}
          className={cn(FIELD, "py-3", FOCUS)} />
        <div className="flex justify-end">{add}</div>
      </form>
    );
  }
  return (
    <form onSubmit={submit} className="flex items-stretch gap-2.5">
      <input id={id} type="text" value={value} aria-label={label} placeholder={placeholder} maxLength={NOTE_CAP} dir="auto"
        enterKeyHint="done" autoComplete="off" onChange={(e) => setValue(e.target.value)}
        className={cn(FIELD, "h-14 min-w-0 flex-1", FOCUS)} />
      {add}
    </form>
  );
}
