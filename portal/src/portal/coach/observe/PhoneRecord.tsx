import { forwardRef, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mic, Upload } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { Card } from "../ui";
import { OBSERVE } from "./copy";
import { lengthShort } from "./format";
import ObservePage from "./ObservePage";
import { useObserveRoutes } from "./observeRoutes";
import { setDraft } from "../observeDraft";
import { AUDIO_ACCEPT, checkRecording, formatSize, readAudioDuration } from "../../lib/coachingUpload";
import { holdFile, isFileRefused, tellUnreadablePick } from "../../lib/pickedRead";
import { latestUnsent } from "../../lib/recordingStore";
import { recordingTeacher } from "../../lib/coachObserve";
import type { CoachVisit } from "../types";

/**
 * bd-oe6r47 (queue #278) — the file input that asks for the PHONE'S OWN RECORDER: `accept="audio/*"` alone (an
 * extension in the list stops Chrome treating it as a sound capture) plus `capture`. Android Chrome then opens the
 * phone's sound recorder (MediaStore RECORD_SOUND) when one is installed, and its file comes back here; where the
 * browser does not honour capture for sound (a WebView: the NIETE app, WhatsApp's browser) it opens the file picker,
 * which is Upload recording. Either way nothing records in the page, so a bad connection cannot lose the audio.
 */
export const PhoneRecorderInput = forwardRef<HTMLInputElement, { testId: string; onFile: (f: File | undefined) => void }>(
  function PhoneRecorderInput({ testId, onFile }, ref) {
    return (
      <input ref={ref} data-testid={testId} type="file" accept="audio/*" capture className="hidden"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    );
  },
);

/**
 * bd-oe6r47 — Record observation while upload-only is on (portal_observe_upload_only, default ON; the switch is read by
 * coach/observe/uploadOnly.ts): no in-app recorder. One line says what to do, the main button opens the phone's
 * recorder (PhoneRecorderInput), Upload recording picks a file. The file is checked and read the way Upload recording
 * always did (CoachAttach: a recording, not too large, its bytes held so the Android app can still send it), then Check
 * and send has it. A recording this phone already keeps for this teacher (the in-app recorder's chunks, IndexedDB) is
 * offered as Send saved recording: Check and send picks it up, as it does after a reload.
 */
export default function PhoneRecord({ visit }: { visit: CoachVisit }) {
  const C = useCopy(OBSERVE);
  const routes = useObserveRoutes();
  const navigate = useNavigate();
  const recordInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [kept, setKept] = useState(false);

  useEffect(() => {
    let live = true;
    latestUnsent()
      .then((u) => {
        const who = u ? recordingTeacher(u.meta.id) : null;
        if (live && who && who.teacherExtId === visit.teacherExtId) setKept(true);
      })
      .catch(() => { /* none to offer */ });
    return () => { live = false; };
  }, [visit.teacherExtId]);

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

  return (
    <ObservePage banner={false} title={C.recordTitle} backTo={routes.visit(visit.id)} feature="observations"
      crumb={<>{visit.teacherName || C.dash}{visit.scheduledSlot && <> · <TimeStamp time={visit.scheduledSlot} size={13} /></>}</>}>
      <Card className="flex flex-col items-center gap-4 p-5 text-center" data-testid="phone-record">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#fee4e2] text-[#c8331f]" aria-hidden="true">
          <Mic className="h-9 w-9" />
        </span>
        <p className="m-0 text-[16px] leading-snug text-[#1d2025]">{C.phoneHint}</p>
        <button type="button" onClick={() => recordInput.current?.click()} disabled={opening}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#33374a] text-base font-semibold text-white disabled:opacity-60">
          <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full bg-[#ff4d3d] shadow-[0_0_0_3px_rgba(255,77,61,0.25)]" />
          {C.recordOnPhone}
        </button>
        <button type="button" onClick={() => uploadInput.current?.click()} disabled={opening}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025] disabled:opacity-60">
          <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />{C.uploadRecording}
        </button>
        <PhoneRecorderInput ref={recordInput} testId="phone-record-input" onFile={(f) => { void onChosen(f); }} />
        <input ref={uploadInput} data-testid="phone-upload-input" type="file" accept={AUDIO_ACCEPT} className="hidden"
          onChange={(e) => { void onChosen(e.target.files?.[0]); e.target.value = ""; }} />
        {opening && <p className="m-0 text-[15px] font-semibold text-[#4b5563]" role="status">{C.openingFile}</p>}
        {error && <div role="alert" className="w-full rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">{error}</div>}
      </Card>
      {kept && (
        <Link to={routes.check(visit.id)} data-testid="send-kept"
          className="mt-3 flex h-14 w-full items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025]">
          {C.sendKept}
        </Link>
      )}
    </ObservePage>
  );
}
