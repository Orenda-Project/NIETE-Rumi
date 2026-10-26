import { useLang } from "../../teacher/i18n";
import { t } from "./text";
import { mmss } from "./format";
import type { Moment } from "./types";

/**
 * bd-sex15q.15 — where m-player's `MomentPlayer` (insights/player, variant "inline") mounts on S2 and in Listen. Until
 * that PR lands this is the plainest honest player: the clip through the authenticated stream route (never a URL from a
 * payload, B4), on tap only (`preload="none"`), with the "opens at the moment" line. Whichever PR lands second swaps
 * this body for `<MomentPlayer moment={moment} variant="inline" />`.
 */
export default function MomentSlot({ moment }: { moment: Moment }) {
  const lang = useLang();
  const failed = moment.clip.status === "failed" || moment.clip.status === "expired";
  const src = failed
    ? `/api/portal/coachip/session/${encodeURIComponent(moment.session.session_id)}/audio`
    : `/api/portal/coachip/m/${encodeURIComponent(moment.moment_id)}/clip`;
  const at = moment.lesson_s ?? moment.clip.from_s;
  return (
    <div data-testid="moment-slot" dir="ltr" className="flex flex-col gap-1.5">
      <audio controls preload="none" src={src} className="w-full" data-clock="">
        <track kind="captions" />
      </audio>
      <p dir={lang === "ur" ? "rtl" : "ltr"} data-clock="" className="text-[13px] text-[#6b7280]">
        {failed ? t("s4.clip_failed", lang, { "mm:ss": mmss(at, "en") }) : t("s4.opens_at", lang, { "mm:ss": mmss(at, "en") })}
      </p>
    </div>
  );
}
