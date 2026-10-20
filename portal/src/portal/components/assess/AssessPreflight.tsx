import { useEffect, useRef, useState } from 'react';
import { Headphones, Mic, PlaneTakeoff, Volume2 } from 'lucide-react';
import type { AssessCopy } from '../../lib/assess/copy';
import type { MicCheck } from '../../lib/assess/visitStore';
import { pickRecordingType } from '../../lib/recordingSupport';

/**
 * The pre-flight card, once per visit before the list: airplane mode, a beep for
 * the headphones, and a microphone check (a live level, 2 s recorded and played
 * back, then the coach says whether they heard it). A blocked or missing
 * microphone is explained and the coach can still go on. Every track is stopped
 * when the check ends.
 */

export const RECORD_MS = 2000;
const BEEP_S = 0.4;
const METER_MS = 50;

type Ctx = AudioContext;
type MicState = 'idle' | 'recording' | 'asking' | 'ok' | 'denied';

function audioContext(): Ctx | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AC = w.AudioContext || w.webkitAudioContext;
  try { return AC ? new AC() : null; } catch { return null; }
}

export function playBeep(): void {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => { void ctx.close().catch(() => {}); };
    osc.start();
    osc.stop(ctx.currentTime + BEEP_S);
  } catch { /* no sound on this device */ }
}

/** Root mean square of 8-bit time-domain samples, 0..1. */
export function rmsOf(buf: Uint8Array): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / buf.length));
}

type Props = { copy: AssessCopy; onMic: (m: MicCheck) => void; onReady: () => void };

export default function AssessPreflight({ copy, onMic, onReady }: Props) {
  const [mic, setMic] = useState<MicState>('idle');
  const [level, setLevel] = useState(0);
  const peak = useRef(0);
  const cleanup = useRef<() => void>(() => {});

  useEffect(() => () => cleanup.current(), []);

  const finish = (ok: boolean) => {
    onMic({ mic_ok: ok, mic_rms: Math.round(peak.current * 100) / 100, at: Date.now() });
  };

  const check = async () => {
    cleanup.current();
    peak.current = 0;
    setLevel(0);
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no microphone');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMic('denied');
      finish(false);
      return;
    }
    setMic('recording');
    const ctx = audioContext();
    let meter: number | null = null;
    let timer: number | null = null;
    let url: string | null = null;
    const stopAll = () => {
      if (meter !== null) window.clearInterval(meter);
      if (timer !== null) window.clearTimeout(timer);
      meter = null;
      timer = null;
      stream.getTracks().forEach((t) => t.stop());
      if (ctx) void ctx.close().catch(() => {});
    };
    cleanup.current = () => {
      stopAll();
      if (url) { try { URL.revokeObjectURL(url); } catch { /* none */ } }
    };
    if (ctx) {
      try {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        meter = window.setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          const r = rmsOf(buf);
          peak.current = Math.max(peak.current, r);
          setLevel(r);
        }, METER_MS);
      } catch { /* no meter; the recording still tells */ }
    }

    const type = pickRecordingType();
    let recorder: MediaRecorder | null = null;
    try {
      recorder = typeof MediaRecorder === 'undefined' ? null : new MediaRecorder(stream, type ? { mimeType: type.mimeType } : undefined);
    } catch { recorder = null; }
    const chunks: Blob[] = [];
    const playBack = () => {
      stopAll();
      setLevel(0);
      if (chunks.length) {
        try {
          url = URL.createObjectURL(new Blob(chunks, { type: type?.mimeType || chunks[0].type }));
          const p = new Audio(url).play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch { /* the coach can still say what they heard */ }
      }
      setMic('asking');
    };
    if (recorder) {
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = playBack;
      try { recorder.start(); } catch { recorder = null; }
    }
    const rec = recorder;
    timer = window.setTimeout(() => {
      timer = null;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); return; } catch { /* fall through */ } }
      playBack();
    }, RECORD_MS);
  };

  const heard = () => { cleanup.current(); setMic('ok'); finish(true); };

  return (
    <div data-testid="assess-preflight" className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">{copy.preflightTitle}</h2>
      <p className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-slate-800">
        <PlaneTakeoff className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden /> {copy.airplane}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <span className="flex items-center gap-3 font-medium text-slate-900"><Headphones className="h-5 w-5 text-slate-500" aria-hidden /> {copy.headphonesIn}</span>
        <button type="button" onClick={playBeep} className="flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4">
          <Volume2 className="h-4 w-4" aria-hidden /> {copy.playSound}
        </button>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        {(mic === 'idle' || mic === 'denied') && (
          <button type="button" onClick={check} className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white font-medium">
            <Mic className="h-4 w-4" aria-hidden /> {copy.micCheck}
          </button>
        )}
        {mic === 'recording' && (
          <div className="space-y-2">
            <p className="text-slate-800">{copy.micSpeak}</p>
            <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} data-testid="assess-mic-level">
              <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${Math.min(100, Math.round(level * 300))}%` }} />
            </div>
          </div>
        )}
        {mic === 'asking' && (
          <div className="space-y-2">
            <p className="text-slate-800">{copy.micListen}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={heard} className="min-h-[48px] rounded-xl bg-emerald-600 font-medium text-white">{copy.micHeard}</button>
              <button type="button" onClick={check} className="min-h-[48px] rounded-xl border border-slate-300 bg-white">{copy.tryAgain}</button>
            </div>
          </div>
        )}
        {mic === 'ok' && <p data-testid="assess-mic-ok" className="flex items-center gap-2 font-medium text-emerald-800"><Mic className="h-4 w-4" aria-hidden /> {copy.micOk}</p>}
        {mic === 'denied' && <p data-testid="assess-mic-denied" role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{copy.micDenied}</p>}
      </div>
      <button type="button" data-testid="assess-preflight-ready" onClick={() => { cleanup.current(); onReady(); }}
        className="w-full min-h-[56px] rounded-2xl bg-emerald-600 text-xl font-semibold text-white">{copy.ready}</button>
    </div>
  );
}
