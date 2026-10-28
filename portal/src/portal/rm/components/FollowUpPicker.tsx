import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLang } from "../../teacher/i18n";
import { CodeText } from "../../coach/insights/count";
import { todayKarachi } from "../../coach/insights/format";
import { pick } from "../../coach/insights/text";
import type { Note, Text } from "../../coach/insights/types";
import { rm } from "../api";
import { addDays, composeLines, defaultDue } from "../compose";
import type { Coach, RmCoach, RmHome, TemplateId } from "../types";
import { rt, rtx } from "../text";
import { Button } from "../../coachip-ui/Button";

/**
 * bd-sex15q.17 — the RM's follow-up (G8, B1 add): the RM picks a template (RM-T1..T4, titles from the server's
 * `monday.templates`), the W, one to three of THAT coach's schools and the date, and types nothing. The preview shows the
 * three lines in both languages; "Send" posts `{coach_user_id, template_id, w_id, school_ids, due_on}` and nothing else
 * (A11: an extra key is a 400). The server composes and stores the lines; the coach reads them on S1, and S9 lists the
 * note with its status. No teacher code appears anywhere in it: the coach finds the codes on S2.
 *
 * The coach's schools come from S9's read (R18), the one RM payload that lists them.
 */
const DEFAULT_TEMPLATE: Record<string, TemplateId> = { unvisited: "RM-T2", checks_overdue: "RM-T3", no_steps: "RM-T1" };

type WOption = { w_id: string; short_name: Text };

export default function FollowUpPicker({ coach, home, onClose, onSent }: {
  coach: Coach; home: RmHome; onClose: () => void; onSent: (note: Note) => void;
}) {
  const lang = useLang();
  const other = lang === "ur" ? "en" : "ur";
  const today = todayKarachi(new Date(home.computed_at));
  const [detail, setDetail] = useState<RmCoach | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const templates = home.monday.templates;
  const [tid, setTid] = useState<TemplateId>(DEFAULT_TEMPLATE[coach.needs_me_reason ?? ""] ?? "RM-T1");
  const [wId, setWId] = useState<string | null>(null);
  const [schoolIds, setSchoolIds] = useState<string[]>([]);
  const [due, setDue] = useState(defaultDue(today));
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  useEffect(() => {
    let live = true;
    rm.coach(coach.coach_user_id).then(
      (d) => {
        if (!live) return;
        setDetail(d);
        setWId((w) => w ?? d.moves[0]?.row.w_id ?? home.moves[0]?.row.w_id ?? null);
        const unvisited = d.schools.filter((s) => (s.weeks_since_visit ?? 99) >= 4).map((s) => s.school.school_id);
        setSchoolIds(tid === "RM-T2" && unvisited.length ? unvisited.slice(0, 3) : d.schools.slice(0, 1).map((s) => s.school.school_id));
      },
      () => { if (live) setLoadFailed(true); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach.coach_user_id]);

  const wOptions: WOption[] = useMemo(() => {
    const seen = new Map<string, WOption>();
    for (const m of detail?.moves ?? []) if (!seen.has(m.row.w_id)) seen.set(m.row.w_id, { w_id: m.row.w_id, short_name: m.row.short_name });
    for (const m of home.moves) if (!seen.has(m.row.w_id)) seen.set(m.row.w_id, { w_id: m.row.w_id, short_name: m.row.short_name });
    return [...seen.values()];
  }, [detail, home.moves]);

  const w = wOptions.find((o) => o.w_id === wId) ?? null;
  const names = (detail?.schools ?? []).filter((s) => schoolIds.includes(s.school.school_id)).map((s) => s.school.school_name);
  // {i_title} is the first school-level I of that W (API §8.5); the client knows it only for the agenda W (the cluster card).
  const agendaW = home.moves.find((m) => m.agenda)?.row.w_id;
  const iTitle = home.cluster && w && w.w_id === agendaW ? home.cluster.title : null;
  const preview = (l: "en" | "ur") => (w ? composeLines(tid, { w_short: w.short_name, schools: names, due_on: due, i_title: iTitle }, l) : null);

  const toggle = (id: string) => setSchoolIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? cur : [...cur, id]));
  const canSend = !!w && schoolIds.length >= 1 && schoolIds.length <= 3 && status !== "sending" && status !== "sent";

  const send = async () => {
    if (!canSend || !w) return;
    setStatus("sending");
    try {
      const { note } = await rm.sendNote({ coach_user_id: coach.coach_user_id, template_id: tid, w_id: w.w_id, school_ids: schoolIds, due_on: due });
      setStatus("sent");
      onSent(note);
    } catch {
      setStatus("failed");
    }
  };

  const lines = (l: "en" | "ur") => {
    const p = preview(l);
    return p ? (
      <ol dir={l === "ur" ? "rtl" : "ltr"} lang={l} data-testid={`picker-preview-${l}`} style={{ listStyleType: l === "ur" ? "urdu" : "decimal" }}
        className="flex flex-col gap-0.5 ps-5 text-[15px] leading-[1.45] text-cp-ink">
        {/* fix-r5 s2 item 17 (design-qa 073629, COPY §0 rule 3): each line takes its own direction and aligns to its start */}
        {p.map((x, i) => <li key={i} data-nonum="" className="[unicode-bidi:plaintext] text-start">{x}</li>)}
      </ol>
    ) : null;
  };

  // bd-sex15q.47: portalled to <body> in its own .cp root. Inside the page, Shell's .cp-enter animates `transform`
  // (fill-mode both), which makes it the containing block of every `fixed` descendant: the sheet was pinned to the
  // bottom of the long page, off-screen, with only its dim showing (S9 phone shot v3picker).
  return createPortal(
    <div className="cp fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" dir={lang === "ur" ? "rtl" : "ltr"} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="picker-title" data-testid="follow-up-picker"
        dir={lang === "ur" ? "rtl" : "ltr"} onClick={(e) => e.stopPropagation()}
        className="cp-sheet flex max-h-[92vh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-t-[20px] bg-cp-surface px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2 text-cp-ink shadow-[0_-2px_8px_rgba(51,55,72,0.08)] md:rounded-[20px] md:px-7 md:pb-7 md:pt-5">
        {/* bd-sex15q.47 (R6, SCREENS S9): a bottom sheet on a phone (200 ms rise, off under reduced motion), a dialog from md */}
        <span aria-hidden="true" className="mx-auto mb-1 block h-1 w-10 rounded-full bg-cp-track md:hidden" />
        <div className="flex items-start justify-between gap-2">
          <h2 id="picker-title" className="text-[20px] font-bold leading-[1.3] text-cp-navy">{rtx("picker.title", lang, { coach: <span data-code="" dir="auto">{coach.coach_label}</span> })}</h2>
          <button type="button" onClick={onClose} aria-label={rt("picker.cancel", lang)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-cp-hairline text-cp-navy outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-2 cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] text-cp-ink-3">{rt("picker.template", lang)}</legend>
          <div className="flex flex-wrap gap-2">
            {templates.map((tp) => (
              <label key={tp.template_id} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[14px] border-[1.5px] px-4 text-[14px] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-cp-navy ${tid === tp.template_id ? "border-cp-green bg-cp-green font-semibold text-cp-navy" : "border-cp-hairline bg-cp-surface text-cp-ink"}`}>
                <input type="radio" name="template" className="sr-only" checked={tid === tp.template_id} onChange={() => setTid(tp.template_id)} data-testid={`picker-template-${tp.template_id}`} />
                {pick(tp.title, lang)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-2 cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] text-cp-ink-3">{rt("picker.w", lang)}</legend>
          <div className="flex flex-wrap gap-2">
            {wOptions.map((o) => (
              <label key={o.w_id} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[14px] border-[1.5px] px-4 text-[14px] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-cp-navy ${wId === o.w_id ? "border-cp-green bg-cp-green font-semibold text-cp-navy" : "border-cp-hairline bg-cp-surface text-cp-ink"}`}>
                <input type="radio" name="w" className="sr-only" checked={wId === o.w_id} onChange={() => setWId(o.w_id)} data-testid={`picker-w-${o.w_id}`} />
                {pick(o.short_name, lang)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-2 cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] text-cp-ink-3">{rt("picker.schools", lang)}</legend>
          {loadFailed && <p role="status" className="text-[14px] text-cp-ink-2">{rt("e.failed_load", lang)}</p>}
          <div className="flex flex-col">
            {(detail?.schools ?? []).map((s) => {
              const on = schoolIds.includes(s.school.school_id);
              return (
                <label key={s.school.school_id} className="flex min-h-[44px] cursor-pointer items-center gap-3 border-t border-cp-hairline text-[15px] first:border-t-0">
                  <input type="checkbox" checked={on} disabled={!on && schoolIds.length >= 3} onChange={() => toggle(s.school.school_id)}
                    data-testid="picker-school" data-school={s.school.school_id} className="h-5 w-5 accent-cp-green" />
                  <CodeText lang={lang}>{s.school.school_name}</CodeText>
                </label>
              );
            })}
          </div>
          {detail && schoolIds.length === 0 && <p className="text-[13px] font-semibold text-cp-navy">{rt("picker.pick_school", lang)}</p>}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] text-cp-ink-3">{rt("picker.date", lang)}</span>
          <input type="date" dir="ltr" value={due} min={today} max={addDays(today, 28)} data-testid="picker-date"
            onChange={(e) => { if (e.target.value) setDue(e.target.value); }}
            className="min-h-[44px] w-48 rounded-[12px] border-[1.5px] border-cp-hairline bg-cp-surface px-3 text-[15px] text-cp-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green" />
        </label>

        <div className="flex flex-col gap-2">
          <div className="rounded-[16px] bg-cp-green-tint px-4 py-3">
            <p className="mb-1.5 text-[12px] font-bold text-cp-green-ink">{rt("picker.preview", lang)}</p>
            {lines(lang)}
          </div>
          <div className="rounded-[16px] bg-cp-grey-fill px-4 py-3">
            <p className="mb-1.5 text-[12px] font-bold text-cp-ink-2">{rt("picker.preview.other", lang)}</p>
            {lines(other)}
          </div>
        </div>

        {status === "sent" && <p role="status" data-testid="picker-sent" className="text-[14px] font-semibold text-cp-green-ink">{rt("picker.sent", lang)}</p>}
        {status === "failed" && <p role="status" data-testid="picker-failed" className="text-[14px] font-semibold text-cp-navy">{rt("picker.failed", lang)}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="quiet" size="md" onClick={onClose}><span>{rt("picker.cancel", lang)}</span></Button>
          <Button onClick={send} disabled={!canSend} testId="picker-send" className="sm:min-w-[200px]">
            <span>{status === "sending" ? rt("e.saving", lang) : rt("picker.send", lang)}</span>
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
