import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import { coachip } from "../api";
import { DateText } from "../count";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { Note } from "../types";

/**
 * bd-sex15q.15 — the RM's note on S1 (DESIGN §3 S1, API R13), in the blue info tone. The server composed the three
 * lines (no free text, no codes); they show verbatim, marked `data-text="note"` because their dates and school names
 * are the server's words, not counts. A `sent` note is marked `seen` once on first show; Done marks it `dismissed` and
 * hides it. A failed post leaves the banner as it was (the next load shows it again).
 */
export function NoteBanner({ note }: { note: Note }) {
  const lang = useLang();
  const [hidden, setHidden] = useState(false);
  const seenPosted = useRef(false);
  useEffect(() => {
    if (note.status !== "sent" || seenPosted.current) return;
    seenPosted.current = true;
    coachip.noteStatus(note.id, "seen").catch(() => undefined);
  }, [note.id, note.status]);
  if (hidden) return null;
  const dismiss = () => {
    coachip.noteStatus(note.id, "dismissed").then(() => setHidden(true), () => undefined);
  };
  const btn = "flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-3 text-[14.5px] font-semibold";
  return (
    <section data-testid="s1-note" data-note={note.id} className="flex flex-col gap-1.5 rounded-2xl bg-[#eef2ff] px-4 py-3 text-[#312e81]">
      {/* label and due date on one line, the three lines as one paragraph: the note stays short so Move 1 stays above the fold */}
      <p className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] font-bold uppercase tracking-[0.08em] rtl:tracking-normal">
        <span>{pick(note.label, lang)}</span>
        <span className="text-[12.5px] font-semibold normal-case tracking-normal text-[#4338ca]">{tx("s1.note.due", lang, { date: <DateText iso={note.due_on} lang={lang} /> })}</span>
      </p>
      <p data-text="note" className="text-[14px] leading-snug [overflow-wrap:anywhere]">
        {note.lines[lang].map((line, i) => <span key={i} data-line={i + 1}>{i > 0 ? " " : ""}{line}</span>)}
      </p>
      <div className="flex gap-2">
        <Link data-testid="s1-note-open" to={insightsPaths.w(note.w_id)} className={`${btn} bg-[#4f46e5] text-white`}>{t("s1.note.open", lang)}</Link>
        <button type="button" data-testid="s1-note-dismiss" onClick={dismiss} className={`${btn} border border-[#c7d2fe] bg-white text-[#312e81]`}>
          {t("s1.note.dismiss", lang)}
        </button>
      </div>
    </section>
  );
}
