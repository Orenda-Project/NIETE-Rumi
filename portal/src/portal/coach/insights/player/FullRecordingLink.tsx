import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { AudioPlayer } from "../../../newui/AudioPlayer";
import { COACHING } from "../../../teacher/coaching/copy";
import { copyIn, type Lang } from "../../../teacher/i18n";
import { t, tx } from "../text";
import { ClockText } from "./LessonClock";

/**
 * bd-sex15q.16 — "Open the full recording (27:40)" behind a tap (DESIGN O14, SPEC v2 §7): nothing is fetched until the
 * coach taps; then the hint and a second kit player on `/api/portal/coachip/session/<id>/audio` (same-origin cookie, the
 * server pipes the bytes; never a bucket URL), `preload="none"` so a whole lesson costs nothing until Play. The player
 * that mounts here is a kit player like the clip's, so starting it pauses the clip (the kit's one-at-a-time rule).
 * Not rendered for the RM circle form (`full_recording = null`, A4).
 */
export default function FullRecordingLink({ sessionId, durationS, label, lang }: { sessionId: string; durationS: number; label: string; lang: Lang }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="full-recording" className="flex flex-col gap-2 border-t border-cp-hairline pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] items-center justify-between gap-2 text-start text-[15px] font-semibold text-cp-ink"
      >
        <span>{tx("s4.full", lang, { duration: <ClockText seconds={durationS} lang={lang} /> })}</span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-cp-ink-3 ${open ? "rotate-90" : "rtl:rotate-180"}`} aria-hidden="true" />
      </button>
      {open && (
        <>
          <p className="text-[13px] leading-snug text-cp-ink-3">{t("s4.full.hint", lang)}</p>
          <div data-testid="full-player" data-clock="">
            <AudioPlayer
              src={`/api/portal/coachip/session/${encodeURIComponent(sessionId)}/audio`}
              label={label}
              durationHint={durationS}
              preload="none"
              copy={copyIn(COACHING, lang).audio}
              testId="moment-full-audio"
            />
          </div>
        </>
      )}
    </div>
  );
}
