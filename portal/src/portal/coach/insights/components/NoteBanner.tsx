import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import { coachip } from "../api";
import { DateText } from "../count";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { Note } from "../types";

/**
 * bd-sex15q.15 — the RM's note on S1 (DESIGN §3 S1, API R13). R6 (bd-sex15q.46): the navy-tint note tone (notice = navy,
 * DESIGN_SYSTEM §6), Open as a secondary button (the overlapping card holds the screen's one primary). The server composed the three
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
  const btn = "cp-press flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] px-3 text-[14px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green";
  return (
    <section data-testid="s1-note" data-note={note.id} className="flex flex-col gap-2 rounded-[16px] bg-cp-navy-tint px-4 py-3.5 text-cp-navy">
      {/* label and due date on one line, the three lines as one paragraph: the note stays short so Move 1 stays above the fold */}
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="cp-label text-[12px] font-bold uppercase tracking-[0.08em]">{pick(note.label, lang)}</span>
        <span className="text-[13px] font-semibold text-cp-ink-2">{tx("s1.note.due", lang, { date: <DateText iso={note.due_on} lang={lang} /> })}</span>
      </p>
      <p data-text="note" className="text-[15px] leading-[1.45] text-cp-ink [overflow-wrap:anywhere]">
        {note.lines[lang].map((line, i) => <span key={i} data-line={i + 1}>{i > 0 ? " " : ""}{line}</span>)}
      </p>
      <div className="flex gap-2">
        <Link data-testid="s1-note-open" to={insightsPaths.w(note.w_id)} className={`${btn} border-2 border-cp-navy bg-white text-cp-navy`}>{t("s1.note.open", lang)}</Link>
        <button type="button" data-testid="s1-note-dismiss" onClick={dismiss} className={`${btn} text-cp-ink-2`}>
          {t("s1.note.dismiss", lang)}
        </button>
      </div>
    </section>
  );
}
