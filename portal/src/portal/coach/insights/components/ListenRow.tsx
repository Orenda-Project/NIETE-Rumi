import { Link } from "react-router-dom";
import { ChevronRight, Play } from "lucide-react";
import { useLang } from "../../../teacher/i18n";
import MomentSlot from "../MomentSlot";
import { CodeText, DateText } from "../count";
import { durButton, mmss } from "../format";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { Moment } from "../types";
import { isolateRuns } from "./bidi";

/**
 * bd-sex15q.15 — one Listen row (G2): "{school} · {short name}" (or "· What good sounds like ✓" for a good example), the
 * lesson's date, and the time button. A tap on the time opens the inline player under the row (the Listen page keeps
 * one open at a time); a tap on the row opens S4. A clip that failed or expired says so and plays the full recording
 * from the moment (`lesson_s`), so its button shows the full recording's length.
 *
 * COPY's `l.row` carries no teacher code, so the row shows none; the code is on S4.
 *
 * R6 (bd-sex15q.46, SCREENS.md Listen): a hairline row; the play control sits at the row's end as a 44 px green circle
 * (navy glyph) beside its time; the inline player (MomentSlot, unchanged) opens under the row.
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
  const expired = moment.clip.status === "expired";
  const sub = failed
    ? <span data-testid={expired ? "listen-row-expired" : "listen-row-failed"}>
        {tx(expired ? "l.row.expired" : "l.row.failed", lang, { date, "mm:ss": <span data-clock="">{mmss(at, lang)}</span> })}
      </span>
    : tx("l.row.sub", lang, { date });
  const dur = durButton(failed ? moment.session.duration_s : moment.clip.duration_s, lang);
  return (
    <li data-testid="listen-row" data-moment={moment.moment_id} data-kind={moment.kind} className="flex flex-col gap-2 border-t border-cp-hairline py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <Link to={insightsPaths.moment(moment.moment_id)} data-testid="listen-open" className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={`text-[17px] font-semibold leading-[1.4] text-cp-ink [overflow-wrap:anywhere] ${isolateRuns(lang)}`}>{head}</span>
            <span className="text-[13px] leading-[1.45] text-cp-ink-3">{sub}</span>
          </span>
          <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 text-cp-ink-3 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <button type="button" data-testid="listen-play" aria-pressed={playing ? "true" : "false"} onClick={onPlay}
          aria-label={t("s1.listen", lang, { dur })}
          className="cp-press flex min-h-[44px] shrink-0 items-center gap-2 rounded-full text-[13px] font-semibold text-cp-ink-2 outline-none focus-visible:ring-[3px] focus-visible:ring-cp-navy">
          <span data-clock="">{dur}</span>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-cp-green text-cp-navy"><Play size={20} className="fill-current rtl:rotate-180" aria-hidden="true" /></span>
        </button>
      </div>
      {playing && <MomentSlot moment={moment} />}
    </li>
  );
}
