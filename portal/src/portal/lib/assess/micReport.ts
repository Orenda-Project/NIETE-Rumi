import { browserEnv, getApiBaseUrl } from '@/lib/runtime';

/**
 * The coach's microphone check, reported to the logs (sa_mic.check). A check that failed on a coach's iPhone left no
 * trace: it runs only on the phone and every failure was swallowed. This says what the phone did — the browser's
 * reason when the microphone was refused, the recorder and its type, how many bytes it recorded, the loudest level the
 * meter read, the AudioContext's state before and after, whether the play-back was refused, the track's settings —
 * and then what the coach answered. Numbers, known words and booleans only: no device id, no recording, no names.
 * Fire-and-forget like dcUploadReport.ts: nothing waits on it and nothing it does can throw into the page.
 */
export type MicProbe = {
  phase: 'probe';
  iosMic: boolean;
  /** The getUserMedia error's name ('NotAllowedError', 'NotFoundError', 'no_api'), or 'ok'. */
  gum: string;
  recorder: boolean;
  mimeType: string;
  bytes: number;
  chunks: number;
  peak: number;
  ctxStart: string;
  ctxEnd: string;
  /** The automatic play-back: 'ok', 'blocked' (the phone refused it), 'error', or 'none' (nothing recorded). */
  play: 'ok' | 'blocked' | 'error' | 'none';
  playError: string;
  sampleRate: number | null;
  channelCount: number | null;
  echoCancellation: boolean | null;
  autoGainControl: boolean | null;
  noiseSuppression: boolean | null;
};

export type MicAnswer = { phase: 'answer'; iosMic: boolean; answer: 'heard' | 'again' | 'skip' | 'replay' };

export function reportMicCheck(r: MicProbe | MicAnswer): void {
  try {
    const body = JSON.stringify({ ...r, b: browserEnv() });
    void fetch(`${getApiBaseUrl()}/funnel/mic-check`, {
      method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'include', keepalive: true,
    }).catch(() => {});
  } catch {
    /* the report never decides anything */
  }
}

/** The track's audio settings that tell a muted or processed microphone apart; never its device or group id. */
export function trackSettings(stream: MediaStream | null): Pick<MicProbe, 'sampleRate' | 'channelCount' | 'echoCancellation' | 'autoGainControl' | 'noiseSuppression'> {
  let s: MediaTrackSettings = {};
  try { s = stream?.getAudioTracks?.()[0]?.getSettings?.() || {}; } catch { s = {}; }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
  return {
    sampleRate: num(s.sampleRate), channelCount: num(s.channelCount),
    echoCancellation: bool(s.echoCancellation), autoGainControl: bool(s.autoGainControl), noiseSuppression: bool(s.noiseSuppression),
  };
}
