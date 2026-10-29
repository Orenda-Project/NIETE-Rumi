import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { FeatureGlyph } from '../icons';
import type { TeacherUiCopy } from './copy';
import { useKitCopy } from './useKitCopy';
import { FOCUS } from './styles';
import { claimSound, releaseSound } from './sounding';

/**
 * bd-fmf24g.2.3 — VoiceNote (COMPONENTS.md §7): a WhatsApp-style incoming voice note — the Digital Coach's ~90 s
 * voice debrief after the report (DC only; the coach visit sends none). An incoming bubble (18px corners, the
 * sending corner 6px): the sender's name (12px/700; the coach's orange, a person indigo), a 56px play/pause, a
 * 28-bar waveform with a seek dot (the played bars green), the duration (or how far it has played) and the time it
 * came, and a 48px avatar with a mic badge (green; blue once heard).
 *
 * With `src` it really plays — preload none (nothing is fetched before she taps: her data), and only one voice note
 * sounds at a time. bd-phk3v4 (ICT feedback, IAB Experience View row 8): in Urdu the PLAYER stays left to right, as a
 * WhatsApp voice note does — play on the left, the waveform filling left to right — while the sender's name and the
 * bubble's place keep the page's direction.
 *
 * bd-bmc9a0.4 — ICT feedback (IAB Experience View, Quratulain):
 *   row 33   a speed chip, as WhatsApp's: while it plays (or is part-way) the avatar's place is a 56px speed button, 1× →
 *            1.5× → 2× → 1×, WhatsApp's own steps (bd-bmc9a0.6: the operator, 29 Oct; 1.25× dropped). The chosen speed is
 *            put back each time the file loads or plays (a browser resets it to 1 on load).
 *   row 34   once it plays it says how far OF its real length ("0:26 / 1:42"), and the waveform is a slider: a tap or
 *            a drag jumps there, the arrows move 5 s, Home and End jump. A tap before it has ever played starts it and
 *            lands there once the file says how long it is.
 */

export interface VoiceNoteProps {
  from: string;
  avatar?: 'dc' | 'person';
  /** For `avatar="person"`. */
  initials?: string;
  /** As shown before it plays ("1:24"). */
  duration: string;
  /** When it came ("10:42"). */
  time: string;
  src?: string;
  /** Already played (the badge turns blue, the waveform lighter). */
  heard?: boolean;
  copy?: Partial<Pick<TeacherUiCopy, 'play' | 'pause' | 'speed'>>;
  className?: string;
}

const BARS = [8, 14, 22, 12, 26, 18, 10, 24, 16, 8, 20, 28, 14, 18, 10, 22, 16, 8, 12, 24, 18, 10, 26, 14, 8, 20, 12, 16];

/** The speed chip's steps (row 33): WhatsApp's. */
export const SPEEDS = [1, 1.5, 2] as const;
/** Seconds an arrow key moves. */
const STEP_S = 5;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** The file's own length, when it says one (a recorder's webm says Infinity: unknown). */
const lengthOf = (d: number | undefined) => (d != null && Number.isFinite(d) && d > 0 ? d : null);

export function VoiceNote({ from, avatar = 'dc', initials = '', duration, time, src, heard = false, copy, className }: VoiceNoteProps) {
  const words = { ...useKitCopy(), ...copy };
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [at, setAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [length, setLength] = useState<number | null>(null);
  const [speed, setSpeed] = useState(0);
  const speedRef = useRef(1);
  /** Where a tap before the file said its length asked to land (0..1). */
  const pending = useRef<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;
    const keepSpeed = () => { el.playbackRate = speedRef.current; };
    const onPlay = () => { setPlaying(true); setPlayed(true); keepSpeed(); };
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); setAt(0); setElapsed(0); };
    const onTime = () => {
      const d = el.duration;
      setElapsed(el.currentTime || 0);
      setAt(Number.isFinite(d) && d > 0 ? Math.min(1, (el.currentTime || 0) / d) : 0);
    };
    const onLength = () => {
      const d = lengthOf(el.duration);
      setLength(d);
      keepSpeed();
      if (d != null && pending.current != null) {
        const t = pending.current * d;
        pending.current = null;
        try { el.currentTime = t; } catch { /* not seekable yet */ }
        setElapsed(t);
        setAt(t / d);
      }
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnd);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onLength);
    el.addEventListener('durationchange', onLength);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onLength);
      el.removeEventListener('durationchange', onLength);
      releaseSound(el);
    };
  }, [src]);

  const start = (el: HTMLAudioElement) => {
    claimSound(el);
    el.playbackRate = speedRef.current;
    void el.play()?.catch?.(() => setPlaying(false));
  };

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) { setPlaying((p) => !p); setPlayed(true); return; }
    if (playing) { el.pause(); return; }
    start(el);
  };

  const nextSpeed = () => {
    const i = (speed + 1) % SPEEDS.length;
    setSpeed(i);
    speedRef.current = SPEEDS[i];
    if (audio.current) audio.current.playbackRate = SPEEDS[i];
  };

  const seekTo = (seconds: number) => {
    const el = audio.current;
    if (!el || length == null) return;
    const t = Math.max(0, Math.min(length, seconds));
    try { el.currentTime = t; } catch { /* not seekable yet: the shown time still moves */ }
    setElapsed(t);
    setAt(t / length);
  };

  /** 0..1 along the waveform at this x; the player is left to right in every language. */
  const fractionAt = (target: HTMLElement, clientX: number) => {
    const r = target.getBoundingClientRect();
    if (!r.width) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !src) return;
    const f = fractionAt(e.currentTarget, e.clientX);
    if (length == null) {
      // never played: start it, and land here once the file says how long it is
      pending.current = f;
      start(el);
      return;
    }
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* an old WebView */ }
    dragging.current = true;
    seekTo(f * length);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current && length != null) seekTo(fractionAt(e.currentTarget, e.clientX) * length);
  };
  const onPointerEnd = () => { dragging.current = false; };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const now = audio.current?.currentTime ?? elapsed;
    let to: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        to = now + STEP_S;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        to = now - STEP_S;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = length ?? 0;
        break;
      default:
        return;
    }
    e.preventDefault();
    seekTo(to);
  };

  const isDc = avatar !== 'person';
  const wasHeard = heard || played;
  const cut = Math.round(at * BARS.length);
  const started = playing || elapsed > 0;
  const shownTime = started
    ? (length != null ? `${clock(elapsed)} / ${clock(length)}` : clock(elapsed))
    : (length != null ? clock(length) : duration);
  const speedLabel = `${SPEEDS[speed]}×`;

  return (
    <div className={cn('flex w-full items-end gap-2 text-[#1d2025]', className)}>
      <div
        role="group"
        aria-label={`${from}, ${duration}`}
        className="flex min-w-0 flex-1 flex-col rounded-[18px] rounded-es-[6px] border border-[#e5e7eb] bg-white pb-1.5 pe-3 ps-1 pt-2 shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
      >
        <div className={cn('ps-2.5 text-[12px] font-bold', isDc ? 'text-[#c2410c]' : 'text-[#33374a]')}>{from}</div>
        <div dir="ltr" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? words.pause : words.play}
            className={cn('flex h-14 w-14 shrink-0 items-center justify-center text-[#4b5563]', FOCUS)}
          >
            {playing ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" />
                <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
              </svg>
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 4.5v15l12.5-7.5z" />
              </svg>
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div
              role="slider"
              tabIndex={src ? 0 : -1}
              aria-label={from}
              aria-valuemin={0}
              aria-valuemax={Math.round(length ?? 0)}
              aria-valuenow={Math.round(elapsed)}
              aria-valuetext={shownTime}
              aria-disabled={!src}
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              // a 56px target drawn in the waveform's 30px: the margins give the 26px back, so the bubble keeps its size
              className={cn('relative -my-[13px] flex h-14 w-full touch-pan-y items-center justify-between rounded-[6px]', src && 'cursor-pointer', FOCUS)}
            >
              {BARS.map((h, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  data-testid="wave-bar"
                  style={{ height: h }}
                  className={cn('pointer-events-none block w-[3px] rounded-[2px]', i < cut ? 'bg-[#2f7a52]' : wasHeard ? 'bg-[#9fc9b1]' : 'bg-[#b7bcc7]')}
                />
              ))}
              <span
                aria-hidden="true"
                style={{ insetInlineStart: `${Math.max(3, Math.round(at * 100))}%` }}
                className="pointer-events-none absolute top-1/2 -ms-[6.5px] -mt-[6.5px] h-[13px] w-[13px] rounded-full bg-[#2f7a52]"
              />
            </div>
            <div className="flex justify-between text-[11.5px] font-semibold tabular-nums text-[#6b7280]">
              <span>{shownTime}</span>
              <span>{time}</span>
            </div>
          </div>
          {src && started ? (
            <button
              type="button"
              onClick={nextSpeed}
              aria-label={`${words.speed} ${speedLabel}`}
              className={cn('flex h-14 w-14 shrink-0 items-center justify-center', FOCUS)}
            >
              <span className="flex h-8 min-w-[48px] items-center justify-center rounded-full bg-[#33374a] px-2 text-[13px] font-bold tabular-nums text-white">
                {speedLabel}
              </span>
            </button>
          ) : (
            <span className="relative ms-1 h-12 w-12 shrink-0">
              {isDc ? (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ffedd5] text-[#c2410c] [--cut:#ffedd5]">
                  <FeatureGlyph name="coaching" size={26} />
                </span>
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#33374a] text-[16px] font-bold text-white">{initials}</span>
              )}
              <span className="absolute -bottom-0.5 -end-[3px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white">
                <span data-testid="mic-badge" className={cn('flex h-[18px] w-[18px] items-center justify-center rounded-full text-white', wasHeard ? 'bg-[#3b82c4]' : 'bg-[#2f7a52]')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
                    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
                  </svg>
                </span>
              </span>
            </span>
          )}
        </div>
        {src ? <audio ref={audio} src={src} preload="none" /> : null}
      </div>
    </div>
  );
}
