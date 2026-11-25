import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mic, Send, Upload } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { Card } from "../ui";
import { OBSERVE } from "./copy";
import { lengthShort } from "./format";
import ObservePage from "./ObservePage";
import { useObserveRoutes } from "./observeRoutes";
import { useKeptFor } from "./keptRecording";
import { setDraft } from "../observeDraft";
import { AUDIO_ACCEPT, checkRecording, formatSize, readAudioDuration } from "../../lib/coachingUpload";
import { holdFile, isFileRefused, tellUnreadablePick } from "../../lib/pickedRead";
import type { CoachVisit } from "../types";

const PRIMARY = "flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#33374a] text-base font-semibold text-white disabled:opacity-60";
const PLAIN = "flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025] disabled:opacity-60";

/**
 * The record step's screen when it does NOT go straight into the in-app recorder.
 *
 * mode "kept" (bd-ih6cej) — the in-app recorder is the default again, but a recording this phone keeps for THIS teacher
 * (keptRecording.ts) is offered first: Send saved recording (Check and send picks it up), Start recording (a new one,
 * onRecord), Upload recording (the upload step), under the weak-internet line. Nothing records until she chooses.
 *
 * mode "upload" (bd-oe6r47; a person portal_observe_upload_only names) — ONE action, Upload recording, with its line. The
 * file is checked and held the way Upload recording always did (CoachAttach), then Check and send has it. bd-ih6cej: the
 * "Record on phone" button (<input accept="audio/*" capture>) is gone: in WhatsApp's in-app browser and the NIETE app it
 * opened the same attach chooser as Upload recording (the operator's test, 25 Nov ~17:15), because neither WebView hands
 * an audio capture to a recorder. A kept copy for this teacher is still offered.
 */
export default function PhoneRecord({ visit, mode, onRecord }: { visit: CoachVisit; mode: "kept" | "upload"; onRecord?: () => void }) {
  const C = useCopy(OBSERVE);
  const routes = useObserveRoutes();
  const navigate = useNavigate();
  const uploadInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const kept = useKeptFor(visit.teacherExtId) === true || mode === "kept";

  const onChosen = async (picked: File | undefined) => {
    setError(null);
    if (!picked) return;
    // bd-hronni: a recording by its name, its type or its first bytes (an .amr or an Opus file with no ending is one)
    const checked = await checkRecording(picked);
    if (checked.problem || !checked.file) { setError(checked.problem === "too_large" ? C.tooLarge : C.notAudio); return; }
    setOpening(true);
    const out = await holdFile(checked.file);
    if (isFileRefused(out)) { tellUnreadablePick("audio", checked.file, out.errName); setOpening(false); setError(C.fileWontOpen); return; }
    const f = out.file;
    const seconds = await readAudioDuration(f);
    const durationMs = seconds != null ? seconds * 1000 : null;
    setDraft(visit.id, {
      blob: f, filename: f.name, durationMs, recordingId: null, label: f.name,
      sub: [lengthShort(durationMs, C), formatSize(f.size)].filter(Boolean).join(" · "),
    });
    navigate(routes.check(visit.id), { replace: true }); // like Upload's Next: Back from Check and send is the visit
  };

  const sendKept = (
    <Link to={routes.check(visit.id)} data-testid="send-kept" className={mode === "kept" ? PRIMARY : PLAIN}>
      <Send className="h-5 w-5 shrink-0" aria-hidden="true" />{C.sendKept}
    </Link>
  );

  return (
    <ObservePage banner={false} title={C.recordTitle} backTo={routes.visit(visit.id)} feature="observations"
      crumb={<>{visit.teacherName || C.dash}{visit.scheduledSlot && <> · <TimeStamp time={visit.scheduledSlot} size={13} /></>}</>}>
      <Card className="flex flex-col items-center gap-4 p-5 text-center" data-testid="phone-record">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#fee4e2] text-[#c8331f]" aria-hidden="true">
          <Mic className="h-9 w-9" />
        </span>
        {mode === "kept" && <h2 className="m-0 text-xl font-semibold" dir="auto">{C.savedOnPhone(visit.teacherName || C.dash)}</h2>}
        <p className="m-0 text-[16px] leading-snug text-[#1d2025]" data-testid="record-tip">{mode === "kept" ? C.weakInternet : C.uploadOnlyLine}</p>
        {mode === "kept" ? (
          <>
            {sendKept}
            <button type="button" onClick={onRecord} className={PLAIN}>
              <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full bg-[#ff4d3d] shadow-[0_0_0_3px_rgba(255,77,61,0.25)]" />
              {C.startRecording}
            </button>
            <Link to={routes.attach(visit.id)} className={PLAIN}>
              <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />{C.uploadRecording}
            </Link>
          </>
        ) : (
          <>
            <button type="button" onClick={() => uploadInput.current?.click()} disabled={opening} className={PRIMARY}>
              <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />{C.uploadRecording}
            </button>
            <input ref={uploadInput} data-testid="phone-upload-input" type="file" accept={AUDIO_ACCEPT} className="hidden"
              onChange={(e) => { void onChosen(e.target.files?.[0]); e.target.value = ""; }} />
            {kept && sendKept}
          </>
        )}
        {opening && <p className="m-0 text-[15px] font-semibold text-[#4b5563]" role="status">{C.openingFile}</p>}
        {error && <div role="alert" className="w-full rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">{error}</div>}
      </Card>
    </ObservePage>
  );
}
