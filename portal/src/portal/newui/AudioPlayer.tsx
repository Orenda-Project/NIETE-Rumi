import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CircleAlert, Loader2, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clockText } from '../lib/clockText';
import { Chip } from './Chip';
import { KIT_COPY } from './copy';
import { FOCUS, isRtl } from './styles';

/**
 * bd-5rz1v.26.4 — the kit's audio player, in place of the browser's own `<audio controls>` (Firefox
 * draws a dark bar that clashes with every new-UI screen; each browser draws a different one).
 *
 *   ( ▶ )  ━━━━━━━━●────────────────  01:23 / 04:56
 *
 * A white card row (or, `bare`, the row alone inside a Panel, which is already the card): a 56px
 * round button — a green ring with the play mark, GREEN FILLED with the pause mark while it plays —
 * then the track (green on the indigo-light track, like every progress bar) that a tap or a drag
 * seeks, then elapsed / total in tabular numbers, left to right even in Urdu. No volume: a phone
 * has buttons for that.
 *
 *   RTL       the track fills from the start side, so it runs right to left in Urdu, and a tap or
 *             the arrow keys follow the reading direction
 *   keyboard  the track is a slider: Space plays and pauses, the arrows (and Up/Down) seek 5s,
 *             Home and End jump; the button is a button
 *   loading   after Play, until the sound starts (and while it buffers): a spinner in the button
 *             that turns only when motion is allowed, and aria-busy
 *   failed    a short red chip, "Can't play", in place of the time; Play tries again
 *   length    the file's own, once it says; until then (preload none — nothing is fetched before
 *             she taps, her data) or when it never says (a recorder's webm reports Infinity),
 *             `durationHint`; with neither, "—" and the track does not seek
 *
 * ONE KIT PLAYER SOUNDS AT A TIME: starting one pauses the other kit player — and nothing else. It
 * owns its own <audio> element and touches no other media, no microphone, no Web Audio and no
 * recording session: a teacher may be recording a lesson (bd-5rz1v.10) while she listens to an
 * earlier report, and listening must never touch that recording (audioPlayer.recording.test.tsx).
 */

export interface AudioPlayerCopy {
  play: string;
  pause: string;
  cantPlay: string;
}

export interface AudioPlayerProps {
  src: string;
  /** What she is listening to ("Digital Coach"): names the seek bar for a screen reader. */
  label: string;
  /** The length in seconds, when it is known before the file says (a lesson's minutes). */
  durationHint?: number | null;
  /** 'none' (default) fetches nothing until she taps Play; 'metadata' reads the length first. */
  preload?: 'none' | 'metadata';
  /** Inside a Panel (already a white card): the row alone, no card of its own. */
  bare?: boolean;
  copy?: AudioPlayerCopy;
  testId?: string;
}

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Seconds a key press moves. */
export const SEEK_STEP_S = 5;

/** The kit player sounding now. Starting another pauses it. Kit players only, never other media. */
let sounding: { stop: () => void } | null = null;

const lengthOf = (n: number | null | undefined): number | null =>
  (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

export function AudioPlayer({
  src, label, durationHint = null, preload = 'none', bare = false, copy = KIT_COPY.audio, testId = 'newui-audio',
}: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const me = useRef({ stop: () => { audio.current?.pause(); } });
  const dragging = useRef(false);
  const [status, setStatus] = useState<Status>('idle');
  const [time, setTime] = useState(0);
  const [ownLength, setOwnLength] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const duration = ownLength ?? lengthOf(durationHint);
  const playing = status === 'playing' || status === 'loading';

  // A new file starts from the beginning.
  useEffect(() => {
    setStatus('idle');
    setTime(0);
    setOwnLength(null);
    setDrag(null);
    dragging.current = false;
  }, [src]);

  // Leaving the page: the element goes (which stops its sound); give up the "sounding" slot.
  useEffect(() => () => { if (sounding === me.current) sounding = null; }, []);

  const claim = () => {
    if (sounding && sounding !== me.current) sounding.stop();
    sounding = me.current;
  };

  const play = () => {
    const el = audio.current;
    if (!el) return;
    if (status === 'error') {
      try { el.load(); } catch { /* it will fail again, and say so */ }
    }
    claim();
    setStatus('loading');
    let started: Promise<void> | undefined;
    try {
      started = el.play();
    } catch {
      setStatus('error');
      return;
    }
    started?.catch((err: unknown) => {
      // Pause before the sound began interrupts play(): not a failure.
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      setStatus('error');
    });
  };

  const toggle = () => {
    if (playing) {
      audio.current?.pause();
      setStatus('paused');
    } else {
      play();
    }
  };

  const seekTo = (seconds: number) => {
    const el = audio.current;
    if (!el || duration == null) return;
    const t = Math.max(0, Math.min(duration, seconds));
    try { el.currentTime = t; } catch { /* not seekable yet: the shown time still moves */ }
    setTime(t);
  };

  /** 0..1 along the track at this x, from the START side (the right, in Urdu). */
  const fractionAt = (clientX: number) => {
    const el = track.current;
    const r = el?.getBoundingClientRect();
    if (!el || !r || !r.width) return 0;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return isRtl(el) ? 1 - f : f;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration == null) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* an old WebView */ }
    dragging.current = true;
    setDrag(fractionAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setDrag(fractionAt(e.clientX));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || duration == null) return;
    dragging.current = false;
    const f = fractionAt(e.clientX);
    setDrag(null);
    seekTo(f * duration);
  };
  const onPointerCancel = () => {
    dragging.current = false;
    setDrag(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = isRtl(e.currentTarget);
    const now = audio.current?.currentTime ?? time;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let to: number | null = null;
    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        toggle();
        return;
      case forward:
      case 'ArrowUp':
        to = now + SEEK_STEP_S;
        break;
      case backward:
      case 'ArrowDown':
        to = now - SEEK_STEP_S;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = duration ?? 0;
        break;
      default:
        return;
    }
    e.preventDefault();
    seekTo(to);
  };

  const readLength = () => setOwnLength(lengthOf(audio.current?.duration));

  const shown = duration == null ? 0 : Math.min(duration, drag != null ? drag * duration : time);
  const fraction = duration ? shown / duration : 0;
  const timeText = `${clockText(shown * 1000)} / ${duration != null ? clockText(duration * 1000) : KIT_COPY.noValue}`;
  const Icon = status === 'loading' ? Loader2 : playing ? Pause : Play;

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={status === 'loading'}
      data-testid={testId}
      className={cn(
        'flex items-center gap-3',
        !bare && 'rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card px-3 py-2.5',
      )}
    >
      <audio
        ref={audio}
        src={src}
        preload={preload}
        onPlay={claim}
        onPlaying={() => setStatus('playing')}
        onWaiting={() => setStatus((s) => (s === 'playing' ? 'loading' : s))}
        onPause={() => setStatus((s) => (s === 'error' ? s : 'paused'))}
        onEnded={() => {
          setStatus('paused');
          if (sounding === me.current) sounding = null;
        }}
        onError={() => {
          setStatus('error');
          if (sounding === me.current) sounding = null;
        }}
        onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)}
        onLoadedMetadata={readLength}
        onDurationChange={readLength}
      />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? copy.pause : copy.play}
        className={cn(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-full',
          FOCUS,
          playing
            ? 'bg-nu-button text-white active:bg-nu-button-edge'
            : 'border-2 border-nu-button bg-nu-surface-card text-nu-button active:bg-nu-ink-xlight',
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn('h-6 w-6', status === 'loading' && 'motion-safe:animate-spin')}
          fill={Icon === Loader2 ? 'none' : 'currentColor'}
        />
      </button>

      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration ?? 0)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={timeText}
        aria-disabled={duration == null}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={cn(
          'flex h-14 min-w-0 flex-1 touch-pan-y items-center rounded-xl px-2',
          duration != null && 'cursor-pointer',
          FOCUS,
        )}
      >
        <div ref={track} data-testid="newui-audio-track" className="relative h-1.5 w-full rounded-full bg-nu-progress-track">
          <div
            data-testid="newui-audio-fill"
            className="absolute inset-y-0 start-0 rounded-full bg-nu-progress"
            style={{ width: `${Math.round(fraction * 10000) / 100}%` }}
          >
            {duration != null ? (
              <span
                aria-hidden="true"
                className="absolute -end-[9px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-nu-progress ring-[3px] ring-nu-surface-card"
              />
            ) : null}
          </div>
        </div>
      </div>

      {status === 'error' ? (
        <Chip tone="error" icon={CircleAlert}>{copy.cantPlay}</Chip>
      ) : (
        <span data-testid="newui-audio-time" dir="ltr" className="shrink-0 text-sm font-bold tabular-nums text-nu-surface-muted">
          {timeText}
        </span>
      )}
    </div>
  );
}
