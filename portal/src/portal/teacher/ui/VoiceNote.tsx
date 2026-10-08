import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { FeatureGlyph } from '../icons';
import { TEACHER_UI_COPY, type TeacherUiCopy } from './copy';
import { FOCUS } from './styles';

/**
 * bd-fmf24g.2.3 — VoiceNote (COMPONENTS.md §7): a WhatsApp-style incoming voice note — the Digital Coach's ~90 s
 * voice debrief after the report (DC only; the coach visit sends none). An incoming bubble (18px corners, the
 * sending corner 6px): the sender's name (12px/700; the coach's orange, a person indigo), a 56px play/pause, a
 * 28-bar waveform with a seek dot (the played bars green), the duration (or how far it has played) and the time it
 * came, and a 48px avatar with a mic badge (green; blue once heard).
 *
 * With `src` it really plays — preload none (nothing is fetched before she taps: her data), and only one voice note
 * sounds at a time. The bubble mirrors in Urdu (the waveform fills from the reading start).
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
  copy?: Partial<Pick<TeacherUiCopy, 'play' | 'pause'>>;
  className?: string;
}

const BARS = [8, 14, 22, 12, 26, 18, 10, 24, 16, 8, 20, 28, 14, 18, 10, 22, 16, 8, 12, 24, 18, 10, 26, 14, 8, 20, 12, 16];

/** The one voice note sounding now: starting another pauses it. */
let sounding: HTMLAudioElement | null = null;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function VoiceNote({ from, avatar = 'dc', initials = '', duration, time, src, heard = false, copy, className }: VoiceNoteProps) {
  const words = { ...TEACHER_UI_COPY, ...copy };
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [at, setAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;
    const onPlay = () => { setPlaying(true); setPlayed(true); };
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); setAt(0); setElapsed(0); };
    const onTime = () => {
      const d = el.duration;
      setElapsed(el.currentTime || 0);
      setAt(Number.isFinite(d) && d > 0 ? Math.min(1, (el.currentTime || 0) / d) : 0);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnd);
    el.addEventListener('timeupdate', onTime);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('timeupdate', onTime);
      if (sounding === el) sounding = null;
    };
  }, [src]);

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) { setPlaying((p) => !p); setPlayed(true); return; }
    if (playing) { el.pause(); return; }
    if (sounding && sounding !== el) sounding.pause();
    sounding = el;
    void el.play()?.catch?.(() => setPlaying(false));
  };

  const isDc = avatar !== 'person';
  const wasHeard = heard || played;
  const cut = Math.round(at * BARS.length);
  const shownTime = playing || elapsed > 0 ? clock(elapsed) : duration;

  return (
    <div className={cn('flex w-full items-end gap-2 text-[#1d2025]', className)}>
      <div
        role="group"
        aria-label={`${from}, ${duration}`}
        className="flex min-w-0 flex-1 flex-col rounded-[18px] rounded-es-[6px] border border-[#e5e7eb] bg-white pb-1.5 pe-3 ps-1 pt-2 shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
      >
        <div className={cn('ps-2.5 text-[12px] font-bold', isDc ? 'text-[#c2410c]' : 'text-[#33374a]')}>{from}</div>
        <div className="flex items-center gap-1.5">
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
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="rtl:-scale-x-100">
                <path d="M7 4.5v15l12.5-7.5z" />
              </svg>
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div aria-hidden="true" className="relative flex h-[30px] items-center justify-between">
              {BARS.map((h, i) => (
                <span
                  key={i}
                  data-testid="wave-bar"
                  style={{ height: h }}
                  className={cn('block w-[3px] rounded-[2px]', i < cut ? 'bg-[#2f7a52]' : wasHeard ? 'bg-[#9fc9b1]' : 'bg-[#b7bcc7]')}
                />
              ))}
              <span
                style={{ insetInlineStart: `${Math.max(3, Math.round(at * 100))}%` }}
                className="absolute top-1/2 -ms-[6.5px] -mt-[6.5px] h-[13px] w-[13px] rounded-full bg-[#2f7a52]"
              />
            </div>
            <div className="flex justify-between text-[11.5px] font-semibold tabular-nums text-[#6b7280]">
              <span>{shownTime}</span>
              <span>{time}</span>
            </div>
          </div>
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
        </div>
        {src ? <audio ref={audio} src={src} preload="none" /> : null}
      </div>
    </div>
  );
}
