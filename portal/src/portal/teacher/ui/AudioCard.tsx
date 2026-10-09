import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { claimSound, releaseSound } from './sounding';
import { FOCUS } from './styles';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — AudioCard: a recording she can play (the coach's Check and send and the observation; the teacher's Digital
 * Coaching lesson and Check). A white card, 84px at least: an optional `lead` (a ScoreRing), the title and a muted second line
 * ("38 min · just now"), an optional `action` (a Redo button), and a 56px round play button, a green ring (GREEN filled with
 * the pause mark while it plays). With `src` it really plays: preload none (nothing is fetched before she taps), and one kit
 * sound at a time (VoiceNote's rule, shared). Without `src` the button only toggles its drawing. Canvas: Coach_Check, Coach_Observation.
 */
export interface AudioCardProps {
  title: string;
  sub?: string;
  src?: string;
  lead?: ReactNode;
  /** A control beside the play button (Redo). Keep it a 56px target. */
  action?: ReactNode;
  copy?: Partial<Pick<TeacherUiCopy, 'play' | 'pause'>>;
  className?: string;
}

export function AudioCard({ title, sub, src, lead, action, copy, className }: AudioCardProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onStop);
    el.addEventListener('ended', onStop);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onStop);
      el.removeEventListener('ended', onStop);
      releaseSound(el);
    };
  }, [src]);

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) { setPlaying((p) => !p); return; }
    if (playing) { el.pause(); return; }
    claimSound(el);
    void el.play()?.catch?.(() => setPlaying(false));
  };

  return (
    <section className={cn('flex min-h-[84px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{bidi(title)}</span>
        {sub ? <span className="text-[13px] leading-[1.3] text-[#6b7280]">{bidi(sub)}</span> : null}
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
      {src ? <audio ref={audio} src={src} preload="none" /> : null}
    </section>
  );
}
