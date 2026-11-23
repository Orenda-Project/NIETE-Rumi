import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { claimSound, releaseSound } from './sounding';
import { FOCUS } from './styles';
import { useKitCopy } from './useKitCopy';
import { SPEEDS } from './VoiceNote';

/**
 * bd-4404s7.1 — AudioCard: a recording she can play (the coach's Check and send and the observation; the teacher's Digital
 * Coaching lesson and Check). A white card, 84px at least: an optional `lead` (a ScoreRing), the title and a muted second line
 * ("38 min · just now"), an optional `action` (a Redo button), and a 56px round play button, a green ring (GREEN filled with
 * the pause mark while it plays). With `src` it really plays: preload none (nothing is fetched before she taps), and one kit
 * sound at a time (VoiceNote's rule, shared). Without `src` the button only toggles its drawing. Canvas: Coach_Check, Coach_Observation.
 */
export interface AudioCardProps {
  title: string;
  /**
   * bd-o15qnr.39 — the full player (the class and debrief recordings on the visit and the Debrief): under the card a
   * bar she can drag to any point, the time and the length, back / forward 10 s and the speed (1× → 1.5× → 2× → 4×, kept on
   * this phone for every player). It reads the file's length up front (preload metadata, a few KB with HTTP range).
   */
  controls?: boolean;
  testId?: string;
  sub?: string;
  src?: string;
  lead?: ReactNode;
  /** A control beside the play button (Redo). Keep it a 56px target. */
  action?: ReactNode;
  copy?: Partial<Pick<TeacherUiCopy, 'play' | 'pause' | 'speed' | 'back10' | 'forward10' | 'position'>>;
  className?: string;
}

/**
 * bd-o15qnr.39 — the speed steps (VoiceNote's, WhatsApp's), and where the chosen one is kept on this phone.
 * bd-o15qnr.40.2 (queue #229, the operator 23 Nov: "add 4x") — the full player adds 4× after 2× (a class recording is
 * 40 minutes); VoiceNote's own steps are unchanged.
 */
export const PLAYBACK_RATES = [...SPEEDS, 4] as const;
export const SPEED_KEY = 'niete.player.speed';
const SKIP_S = 10;

function readRate(): number {
  try {
    const v = Number(window.localStorage.getItem(SPEED_KEY));
    return (PLAYBACK_RATES as readonly number[]).includes(v) ? v : 1;
  } catch { return 1; }
}
function keepRate(v: number): void {
  try { window.localStorage.setItem(SPEED_KEY, String(v)); } catch { /* private window: this player still has it */ }
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** A file's own length when it says one (a recorder's webm may say Infinity until it is read to the end). */
const lengthOf = (d: number) => (Number.isFinite(d) && d > 0 ? d : null);

export function AudioCard({ title, sub, src, lead, action, copy, className, controls = false, testId }: AudioCardProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(() => (controls ? readRate() : 1));
  const rateRef = useRef(rate);
  /** True while the real length of an "Infinity" recording is being read (it is asked to seek to the end once). */
  const probing = useRef(false);

  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;
    const onPlay = () => { setPlaying(true); if (controls) el.playbackRate = rateRef.current; };
    const onStop = () => setPlaying(false);
    // bd-o15qnr.39 — the full player's bar: the length (and the Infinity trick for a recorder's webm), and where it is.
    const onLength = () => {
      if (!controls) return;
      el.playbackRate = rateRef.current;
      const d = lengthOf(el.duration);
      if (d != null) {
        setLength(d);
        if (probing.current) { probing.current = false; try { el.currentTime = 0; } catch { /* stays where it is */ } setAt(0); }
        return;
      }
      if (el.duration === Infinity && !probing.current) {
        probing.current = true;
        try { el.currentTime = 1e101; } catch { probing.current = false; }
      }
    };
    const onTime = () => { if (controls && !probing.current) setAt(el.currentTime || 0); };
    if (controls) { el.defaultPlaybackRate = rateRef.current; el.playbackRate = rateRef.current; }
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onStop);
    el.addEventListener('ended', onStop);
    el.addEventListener('loadedmetadata', onLength);
    el.addEventListener('durationchange', onLength);
    el.addEventListener('timeupdate', onTime);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onStop);
      el.removeEventListener('ended', onStop);
      el.removeEventListener('loadedmetadata', onLength);
      el.removeEventListener('durationchange', onLength);
      el.removeEventListener('timeupdate', onTime);
      releaseSound(el);
    };
  }, [src, controls]);

  const seekTo = (seconds: number) => {
    const el = audio.current;
    if (!el) return;
    const end = length ?? lengthOf(el.duration);
    const t = Math.max(0, end != null ? Math.min(seconds, end) : seconds);
    try { el.currentTime = t; } catch { /* not seekable yet */ }
    setAt(t);
  };
  const nextRate = () => {
    const i = (PLAYBACK_RATES as readonly number[]).indexOf(rate);
    const v = PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
    rateRef.current = v;
    setRate(v);
    keepRate(v);
    if (audio.current) audio.current.playbackRate = v;
  };

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) { setPlaying((p) => !p); return; }
    if (playing) { el.pause(); return; }
    claimSound(el);
    void el.play()?.catch?.(() => setPlaying(false));
  };

  const card = (
    <section data-testid={controls ? undefined : testId} className={cn('flex min-h-[84px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]', !controls && className, controls && 'rounded-b-none border-b-0 shadow-none')}>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span {...bidi.ltr(title)} className="text-[16px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{bidi(title)}</span>
        {sub ? <span {...bidi.ltr(sub)} className="text-[13px] leading-[1.3] text-[#6b7280]">{bidi(sub)}</span> : null}
      </span>
      {action}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? words.pause : words.play}
        className={cn(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#48b078]',
          playing ? 'bg-[#48b078] text-white' : 'bg-white text-[#48b078]',
          FOCUS,
        )}
      >
        {playing
          ? <Pause className="h-6 w-6" fill="currentColor" strokeWidth={0} aria-hidden="true" />
          : <Play className="h-6 w-6 rtl:-scale-x-100" fill="currentColor" strokeWidth={0} aria-hidden="true" />}
      </button>
      {src ? <audio ref={audio} src={src} preload={controls ? 'metadata' : 'none'} /> : null}
    </section>
  );
  if (!controls) return card;

  const SMALL = cn('flex min-h-[56px] min-w-[56px] items-center justify-center gap-1 rounded-xl px-2 text-[14px] font-semibold text-[#33374a]', FOCUS);
  const rateLabel = `${rate}×`;
  return (
    <div data-testid={testId} className={cn('flex flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}>
      {card}
      <div dir="ltr" className="flex flex-col gap-0.5 px-3 pb-2">
        <input type="range" aria-label={words.position} min={0} max={length ?? 0} step={1} value={Math.min(at, length ?? 0)} disabled={length == null}
          onChange={(e) => seekTo(Number(e.target.value))}
          className={cn('h-10 w-full cursor-pointer accent-[#48b078] disabled:cursor-default disabled:opacity-50', FOCUS)} />
        <div className="flex items-center justify-between text-[13px] tabular-nums text-[#6b7280]">
          <span data-testid="audio-time" dir="ltr">{clock(at)}</span>
          <span data-testid="audio-length" dir="ltr">{length != null ? clock(length) : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => seekTo((audio.current?.currentTime ?? at) - SKIP_S)} aria-label={words.back10} className={SMALL}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" /><span aria-hidden="true">10</span>
          </button>
          <button type="button" onClick={nextRate} aria-label={`${words.speed} ${rateLabel}`}
            className={cn(SMALL, 'min-w-[72px] rounded-full bg-[#f3f4f6] tabular-nums')}>{rateLabel}</button>
          <button type="button" onClick={() => seekTo((audio.current?.currentTime ?? at) + SKIP_S)} aria-label={words.forward10} className={SMALL}>
            <span aria-hidden="true">10</span><RotateCw className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
