import { Link } from "react-router-dom";
import { ChevronRight, Play } from "lucide-react";
import { useLang } from "../../../teacher/i18n";
import MomentSlot from "../MomentSlot";
import { CodeText, DateText } from "../count";
import { durButton, mmss } from "../format";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { Moment } from "../types";

/**
 * bd-sex15q.15 — one Listen row (G2): "{school} · {short name}" (or "· What good sounds like ✓" for a good example), the
 * lesson's date, and the time button. A tap on the time opens the inline player under the row (the Listen page keeps
 * one open at a time); a tap on the row opens S4. A clip that failed or expired says so and plays the full recording
 * from the moment (`lesson_s`), so its button shows the full recording's length.
 *
 * COPY's `l.row` carries no teacher code, so the row shows none; the code is on S4.
 */
export default function ListenRow({ moment, playing, onPlay }: { moment: Moment; playing: boolean; onPlay: () => void }) {
  const lang = useLang();
  const failed = moment.clip.status === "failed" || moment.clip.status === "expired";
  const school = <CodeText lang={lang}>{moment.school.school_name}</CodeText>;
  const date = <DateText iso={moment.session.recorded_on} lang={lang} />;
  const head = moment.kind === "good"
    ? tx("l.row.good", lang, { school })
    : tx("l.row", lang, { school, short_name: pick(moment.w.short_name, lang) });
  const at = moment.lesson_s ?? moment.clip.from_s;
  const sub = failed
    ? <span data-testid="listen-row-failed">{tx("l.row.failed", lang, { date, "mm:ss": <span data-clock="">{mmss(at, lang)}</span> })}</span>
    : tx("l.row.sub", lang, { date });
  const dur = durButton(failed ? moment.session.duration_s : moment.clip.duration_s, lang);
  return (
    <li data-testid="listen-row" data-moment={moment.moment_id} data-kind={moment.kind} className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <Link to={insightsPaths.moment(moment.moment_id)} data-testid="listen-open" className="flex min-h-[44px] min-w-0 flex-1 items-center gap-1">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15.5px] font-semibold leading-snug text-[#1d2025] [overflow-wrap:anywhere]">{head}</span>
            <span className="text-[13px] leading-snug text-[#6b7280]">{sub}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
        </Link>
        <button type="button" data-testid="listen-play" aria-pressed={playing ? "true" : "false"} onClick={onPlay}
          aria-label={t("s1.listen", lang, { dur })}
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-[#d1d5db] bg-white ps-1.5 pe-3 text-[14.5px] font-semibold text-[#1d2025]">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#33374a] text-white"><Play className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /></span>
          <span data-clock="">{dur}</span>
        </button>
      </div>
      {playing && <MomentSlot moment={moment} />}
    </li>
  );
}
