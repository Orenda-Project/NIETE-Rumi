import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Mic, Pause, Smartphone } from 'lucide-react';
import SoundBars from '../SoundBars';
import BottomSheet from '../BottomSheet';
import { pickRecordingType } from '../../../lib/recordingSupport';
import { keepScreenOn } from '../../../lib/keepAwake';
import { LessonRecorder, type FinishedRecording } from '../../../lib/lessonRecorder';

/**
 * bd-5rz1v.6 — the recorder a coach uses, for her teacher's lesson and for her
 * talk with the teacher afterwards. The teacher's recorder in every way that
 * matters (the same LessonRecorder, kept on the phone as it records, the screen
 * held on, Finish asks first) with one addition: a label naming WHOSE lesson or
 * talk this is, so a coach visiting three teachers in a morning cannot record
 * one under another's name.
 *
 * It starts on mount. A refused microphone calls onMicBlocked; Finish hands the
 * recording to onFinished.
 */

export function clockText(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function minutesText(ms: number): string {
  if (ms < 60_000) return 'less than a minute';
  const m = Math.round(ms / 60_000);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** A live 0..1 microphone level, or null where Web Audio is unavailable. */
function useMicLevel(stream: MediaStream | null, active: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!stream || !active) return undefined;
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return undefined;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setLevel(Math.sqrt(sum / buf.length));
      }, 120);
    } catch {
      setLevel(null);
    }
    return () => {
      if (timer) clearInterval(timer);
      try { void ctx?.close(); } catch { /* closed */ }
    };
  }, [stream, active]);
  return level;
}

const Warning = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[15px] leading-snug text-[#7a5600]">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

export type CoachRecorderCopy = {
  hearing: string;
  keepOpen: string;
  shortNote: string;
};

const CoachRecorder = ({
  label, copy, shortMs, onStarted, onFinished, onMicBlocked,
}: {
  /** "Observing: Ayesha Bibi" / "Your talk with Ayesha Bibi". */
  label: string;
  copy: CoachRecorderCopy;
  /** Under this, Finish warns that the recording is short. */
  shortMs: number;
  /** The phone copy's id, the moment recording starts (so a page can remember whose it is). */
  onStarted?: (recordingId: string) => void;
  onFinished: (rec: FinishedRecording) => void;
  onMicBlocked: () => void;
}) => {
  const recorderRef = useRef<LessonRecorder | null>(null);
  const releaseScreen = useRef<(() => Promise<void>) | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [screenWentOff, setScreenWentOff] = useState(false);
  const level = useMicLevel(stream, recording && !paused);

  // Start once, on mount; never leave the microphone or the screen hold on.
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const type = pickRecordingType();
      if (!type) { onMicBlocked(); return; }
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          // A classroom, not a call: call-style processing would also suppress
          // children answering from across the room.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
        });
      } catch {
        if (!cancelled) onMicBlocked();
        return;
      }
      if (cancelled) { media.getTracks().forEach((t) => t.stop()); return; }
      const rec = new LessonRecorder({ stream: media, type });
      recorderRef.current = rec;
      setStream(media);
      try {
        await rec.start();
      } catch {
        if (!cancelled) onMicBlocked();
        return;
      }
      releaseScreen.current = await keepScreenOn();
      if (cancelled) return;
      onStarted?.(rec.id);
      setRecording(true);
    };
    void start();
    return () => {
      cancelled = true;
      void releaseScreen.current?.();
      if (recorderRef.current) void recorderRef.current.stop().catch(() => {});
    };
    // Mount-only: the callbacks belong to the page that mounted it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock, and a guard against leaving while recording.
  useEffect(() => {
    if (!recording) return undefined;
    const tick = setInterval(() => setElapsed(recorderRef.current?.elapsedMs() ?? 0), 500);
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onHide = () => { if (document.visibilityState === 'hidden') setScreenWentOff(true); };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(tick);
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [recording]);

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (paused) { rec.resume(); setPaused(false); } else { rec.pause(); setPaused(true); }
    setElapsed(rec.elapsedMs());
  };

  const finish = async () => {
    const rec = recorderRef.current;
    setConfirmFinish(false);
    if (!rec) return;
    const out = await rec.stop();
    recorderRef.current = null;
    setStream(null);
    setRecording(false);
    void releaseScreen.current?.();
    releaseScreen.current = null;
    onFinished(out);
  };

  const now = recorderRef.current?.elapsedMs() ?? elapsed;

  return (
    <div className="flex min-h-[70vh] flex-col items-center gap-4 rounded-2xl bg-white px-5 pb-6 pt-6">
      <div className="rounded-full bg-[#eef0f4] px-4 py-1.5 text-center text-[15px] font-bold text-primary" dir="auto">{label}</div>
      <div className={`flex items-center gap-2.5 rounded-full px-4 py-2 text-[17px] font-bold ${paused ? 'bg-[#eef0f4] text-[#5b6170]' : 'bg-[#fdecea] text-[#c62828]'}`}>
        <span className="relative flex h-[18px] w-[18px] items-center justify-center" aria-hidden="true">
          {!paused && <span className="absolute inset-0 rounded-full bg-[rgba(229,57,53,0.55)] animate-attention-ring motion-reduce:hidden" />}
          <span className={`relative h-3 w-3 ${paused ? 'rounded-sm bg-[#5b6170]' : 'rounded-full bg-[#c62828]'}`} />
        </span>
        <span>{paused ? 'Paused' : 'Recording'}</span>
      </div>
      <div className="text-[72px] font-bold leading-none tabular-nums" aria-live="off">{clockText(elapsed)}</div>
      <SoundBars live={recording && !paused} level={level} />
      <div className="-mt-1 text-base text-[#3a3f4b]">{paused ? 'Recording is paused.' : copy.hearing}</div>
      {screenWentOff && <Warning>The screen went off for a while. Part of it may be silent. Keep this screen open.</Warning>}
      <div className="flex w-full items-center gap-3 rounded-xl bg-[#f4f5f6] p-3.5 text-[15px] leading-snug text-[#3a3f4b]">
        <Smartphone className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <span>{copy.keepOpen}</span>
      </div>
      <div className="flex-1" />
      <button type="button" onClick={() => setConfirmFinish(true)} disabled={!recording}
        className="flex h-16 w-full items-center justify-center gap-3 rounded-[14px] bg-primary text-xl font-bold text-white disabled:opacity-60">
        <span className="h-[18px] w-[18px] rounded-[3px] bg-white" aria-hidden="true" />
        Finish
      </button>
      <button type="button" onClick={togglePause} disabled={!recording}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary disabled:opacity-60">
        {paused ? <Mic className="h-5 w-5" aria-hidden="true" /> : <Pause className="h-5 w-5" aria-hidden="true" />}
        {paused ? 'Continue' : 'Pause'}
      </button>

      {confirmFinish && (
        <BottomSheet label="Finish recording?" onClose={() => setConfirmFinish(false)}>
          <div className="text-[23px] font-bold">Finish recording?</div>
          <div className="text-[17px] text-[#3a3f4b]">You recorded {minutesText(now)}.</div>
          {now < shortMs && <Warning>{copy.shortNote}</Warning>}
          <button type="button" onClick={finish} className="h-[60px] rounded-[14px] bg-primary text-[19px] font-bold text-white">Yes, finish</button>
          <button type="button" onClick={() => setConfirmFinish(false)}
            className="h-14 rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary">Keep recording</button>
        </BottomSheet>
      )}
    </div>
  );
};

export default CoachRecorder;
