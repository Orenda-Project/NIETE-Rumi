import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { claimSound, releaseSound } from './sounding';
import { FOCUS } from './styles';
import { useKitCopy } from './useKitCopy';
import { SPEEDS } from './VoiceNote';
import { nearItsEnd, sameRecording } from './signedLink';
import { canSave, saveRecordingToPhone, type SaveHow, type SaveKind } from '../../lib/saveRecording';

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
  /**
   * bd-o15qnr.47 (queue #243, the operator 23 Nov: the visit's items push the next step "all the way down") — with
   * `controls`: one row until she plays it (the title, its length, the play button); the bar, ±10 s and the speed open
   * under it on her first tap and stay. The same audio element throughout, so the open never stops the sound.
   */
  compact?: boolean;
  testId?: string;
  sub?: string;
  src?: string;
  lead?: ReactNode;
  /** A control beside the play button (Redo). Keep it a 56px target. */
  action?: ReactNode;
  copy?: Partial<Pick<TeacherUiCopy, 'play' | 'pause' | 'speed' | 'back10' | 'forward10' | 'position' | 'saveToPhone' | 'saving' | 'savedToPhone' | 'saveLinkCopied' | 'saveFailed'>>;
  className?: string;
  /**
   * Queue #251 (the operator 24 Nov: "when you click on the timestamp, it should show you the recording part of it") —
   * play from here: each new `n` moves the player to `seconds` and plays (a compact one opens its bar). A seek asked
   * before the file's length is known lands once it is (#239's rule), so a tap on a fresh player starts at that time.
   */
  startAt?: { seconds: number; n: number } | null;
  /** Says when it starts or stops playing (a time chip shows which moment is playing). */
  onPlaying?: (playing: boolean) => void;
  /**
   * bd-ma9jiy (queue #262; the operator 25 Nov ~19:50: "the button to save the recording ... on the component where there's
   * a seek bar") — with `controls`: Save to phone under the bar, the file named `filename` (lib/saveRecording
   * recordingFilename: NIETE_OBS_3Eng_25Nov_1040.webm). Shown only where it can work (canSave: a phone-only copy needs a
   * plain browser). The answer stays on screen 10 s.
   */
  save?: { filename: string; kind: SaveKind | 'dc'; recordingId?: string | null };
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

export function AudioCard({ title, sub, src, lead, action, copy, className, controls = false, compact = false, testId, startAt = null, onPlaying, save }: AudioCardProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(() => (controls ? readRate() : 1));
  /** bd-o15qnr.47 — a compact player opens its bar on her first tap. */
  const [opened, setOpened] = useState(false);
  const showBar = controls && (!compact || opened);
  const rateRef = useRef(rate);
  /** True while the real length of an "Infinity" recording is being read (it is asked to seek to the end once). */
  const probing = useRef(false);
  /**
   * bd-r24965 — the link the player holds. A new `src` makes the browser load the file again (position 0, paused, and no
   * "pause" event, so the button said Pause over a stopped player: the operator's "goes back to 0:00 and does not
   * play"). So a newly signed link to the SAME recording is not handed to the element; only another recording is, and
   * then the player starts over, honestly showing Play.
   */
  const [held, setHeld] = useState(src);
  if (src !== held && !sameRecording(held, src)) {
    setHeld(src);
    setPlaying(false);
    setAt(0);
    setLength(null);
  }
  /** The newest link the page has (taken over if the held one expires: R2 refuses a link after its hour). */
  const newest = useRef(src);
  useEffect(() => { newest.current = src; }, [src]);
  const playingRef = useRef(false);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  /** Where she is, as last known (the display's `at` without waiting for a render). */
  const atRef = useRef(0);
  /** True once this file's length is known: until then a seek is kept in `pending` and applied when it is. */
  const ready = useRef(false);
  const pending = useRef<number | null>(null);
  /** After an expired link: where to pick up on the newest one, and whether it was playing. */
  const resume = useRef<{ src: string; t: number; play: boolean } | null>(null);

  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;
    // (re)bound for a new link, or because `controls` changed (the v6/v7 switch answers after the first paint): what the
    // element already knows stands.
    ready.current = el.readyState >= 1 && lengthOf(el.duration) != null;
    probing.current = false;
    pending.current = null;
    if (resume.current && resume.current.src !== held) resume.current = null;
    if (!resume.current) atRef.current = el.currentTime || 0;
    const onPlay = () => { setPlaying(true); if (controls) el.playbackRate = rateRef.current; };
    const onStop = () => setPlaying(false);
    // bd-o15qnr.39 — the full player's bar: the length (and the Infinity trick for a recorder's webm), and where it is.
    // bd-r24965 — a seek asked before the length was known (or while it was being measured) lands where she asked, and
    // a pick-up after an expired link lands where she was; never back to 0:00 behind her.
    const onLength = () => {
      if (controls) el.playbackRate = rateRef.current;
      const d = lengthOf(el.duration);
      if (d == null) {
        if (controls && el.duration === Infinity && !probing.current) {
          probing.current = true;
          try { el.currentTime = 1e101; } catch { probing.current = false; }
        }
        if (probing.current || Number.isNaN(el.duration)) return; // the rest waits for the real length
      }
      ready.current = true;
      if (controls && d != null) setLength(d);
      const back = resume.current;
      resume.current = null;
      const measured = probing.current;
      probing.current = false;
      const want = pending.current ?? back?.t ?? (measured ? 0 : null);
      pending.current = null;
      if (want != null) {
        const t = Math.max(0, d != null ? Math.min(want, d) : want);
        try { el.currentTime = t; } catch { /* stays where it is */ }
        atRef.current = t;
        if (controls) setAt(t);
      }
      if (back?.play) { claimSound(el); void el.play()?.catch?.(() => setPlaying(false)); }
    };
    const onTime = () => {
      if (probing.current || pending.current != null) return;
      atRef.current = el.currentTime || 0;
      if (controls) setAt(atRef.current);
    };
    // bd-r24965 — whatever reloads the file (another recording, the browser itself), the button never says Pause over a
    // stopped player: a reload fires "emptied", never "pause".
    const onEmptied = () => setPlaying(false);
    // bd-r24965 — the held link expired while the page was open (R2 answers 403 on the next range request): take the
    // newest link to the same recording and pick up where she was. Anything else: the player stops, showing Play.
    const takeNewest = () => {
      const now = el.getAttribute('src');
      const next = newest.current;
      if (!now || !next || next === now || !sameRecording(now, next)) return false;
      resume.current = { src: next, t: pending.current ?? atRef.current, play: playingRef.current };
      setHeld(next);
      return true;
    };
    const onError = () => { if (!takeNewest()) setPlaying(false); };
    // Chrome fires no "error" for an expired link (ORB blocks R2's XML 403): the player waits. A wait on a link at its end
    // moves to the newest one; a wait on a live link is only the network.
    const onWaiting = () => { if (nearItsEnd(el.getAttribute('src'))) takeNewest(); };
    if (controls) { el.defaultPlaybackRate = rateRef.current; el.playbackRate = rateRef.current; }
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onStop);
    el.addEventListener('ended', onStop);
    el.addEventListener('emptied', onEmptied);
    el.addEventListener('error', onError);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('stalled', onWaiting);
    el.addEventListener('loadedmetadata', onLength);
    el.addEventListener('durationchange', onLength);
    el.addEventListener('timeupdate', onTime);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onStop);
      el.removeEventListener('ended', onStop);
      el.removeEventListener('emptied', onEmptied);
      el.removeEventListener('error', onError);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('stalled', onWaiting);
      el.removeEventListener('loadedmetadata', onLength);
      el.removeEventListener('durationchange', onLength);
      el.removeEventListener('timeupdate', onTime);
      releaseSound(el);
    };
  }, [held, controls]);

  /** Where she is now, for back / forward 10 s: the kept seek while the length is not known yet, else the audio's own. */
  const where = () => {
    const el = audio.current;
    if (!el || probing.current || !ready.current || pending.current != null) return pending.current ?? atRef.current;
    return el.currentTime || 0;
  };
  const seekTo = (seconds: number) => {
    const el = audio.current;
    if (!el) return;
    const end = length ?? lengthOf(el.duration);
    const t = Math.max(0, end != null ? Math.min(seconds, end) : seconds);
    atRef.current = t;
    setAt(t);
    // bd-r24965 — the held link is at its end and the page has a newer one to the same recording: a seek would only
    // stall on it, so the newest link takes over and lands at t (playing if it was).
    if (moveToNewest(t)) return;
    // bd-r24965 — not read yet, or measuring an Infinity-long recording: keep it (the measuring would undo it) and land
    // there once the length is known.
    if (probing.current || !ready.current) { pending.current = t; return; }
    try { el.currentTime = t; } catch { pending.current = t; }
  };
  /** The newest link takes over at t when the held one is at its end (see nearItsEnd); false when nothing changed. */
  const moveToNewest = (t: number, play = playingRef.current): boolean => {
    const next = newest.current;
    if (!held || !next || next === held || !nearItsEnd(held) || !sameRecording(held, next)) return false;
    resume.current = { src: next, t, play };
    setHeld(next);
    return true;
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
    if (compact) setOpened(true);
    const el = audio.current;
    if (!el || !held) { setPlaying((p) => !p); return; }
    if (playing) { el.pause(); return; }
    if (moveToNewest(where(), true)) return; // bd-r24965 — Play on a link at its end: the newest one, where she was
    claimSound(el);
    void el.play()?.catch?.(() => setPlaying(false));
  };

  // Queue #251 — play from here: a new request moves the player there and plays (the seek waits for the length if need be).
  const jumped = useRef<number | null>(null);
  const jumpTo = useRef<(seconds: number) => void>(() => undefined);
  jumpTo.current = (seconds: number) => {
    const el = audio.current;
    if (!el || !held) return;
    if (compact) setOpened(true);
    seekTo(seconds);
    if (playingRef.current) return;
    claimSound(el);
    void el.play()?.catch?.(() => setPlaying(false));
  };
  useEffect(() => {
    if (!startAt || startAt.n === jumped.current) return;
    jumped.current = startAt.n;
    jumpTo.current(startAt.seconds);
  }, [startAt]);
  const said = useRef(onPlaying);
  said.current = onPlaying;
  useEffect(() => { said.current?.(playing); }, [playing]);

  // bd-o15qnr.47 — a compact player's second line is the recording's length when nothing else is given.
  const line = sub || (compact && length != null ? clock(length) : undefined);
  const card = (
    <section data-testid={controls ? undefined : testId} className={cn('flex min-h-[84px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]', !controls && className, controls && 'rounded-b-none border-b-0 shadow-none', compact && 'min-h-[72px] border-0')}>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span {...bidi.ltr(title)} className="text-[16px] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{bidi(title)}</span>
        {line ? <span {...bidi.ltr(line)} className="text-[13px] leading-[1.3] text-[#6b7280]">{bidi(line)}</span> : null}
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
      {held ? <audio ref={audio} src={held} preload={controls ? 'metadata' : 'none'} /> : null}
    </section>
  );
  if (!controls) return card;

  const SMALL = cn('flex min-h-[56px] min-w-[56px] items-center justify-center gap-1 rounded-xl px-2 text-[14px] font-semibold text-[#33374a]', FOCUS);
  const saveShown = !!save && canSave(held ?? null);
  const rateLabel = `${rate}×`;
  return (
    <div data-testid={testId} data-open={compact ? (opened ? 'yes' : 'no') : undefined} className={cn('flex flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}>
      {card}
      {showBar && <div dir="ltr" className="flex flex-col gap-0.5 px-3 pb-2">
        <input type="range" aria-label={words.position} min={0} max={length ?? 0} step={1} value={Math.min(at, length ?? 0)} disabled={length == null}
          onChange={(e) => seekTo(Number(e.target.value))}
          className={cn('h-10 w-full cursor-pointer accent-[#48b078] disabled:cursor-default disabled:opacity-50', FOCUS)} />
        <div className="flex items-center justify-between text-[13px] tabular-nums text-[#6b7280]">
          <span data-testid="audio-time" dir="ltr">{clock(at)}</span>
          <span data-testid="audio-length" dir="ltr">{length != null ? clock(length) : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => seekTo(where() - SKIP_S)} aria-label={words.back10} className={SMALL}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" /><span aria-hidden="true">10</span>
          </button>
          <button type="button" onClick={nextRate} aria-label={`${words.speed} ${rateLabel}`}
            className={cn(SMALL, 'min-w-[72px] rounded-full bg-[#f3f4f6] tabular-nums')}>{rateLabel}</button>
          <button type="button" onClick={() => seekTo(where() + SKIP_S)} aria-label={words.forward10} className={SMALL}>
            <span aria-hidden="true">10</span><RotateCw className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {saveShown && save ? <SaveToPhone src={newest.current || held || ''} save={save} words={words} /> : null}
      </div>}
    </div>
  );
}

const SAVE_HOLD_MS = 10_000;

/** bd-ma9jiy — the player's Save to phone: one press, then what came of it (held 10 s). */
function SaveToPhone({ src, save, words }: {
  src: string;
  save: NonNullable<AudioCardProps['save']>;
  words: Pick<TeacherUiCopy, 'saveToPhone' | 'saving' | 'savedToPhone' | 'saveLinkCopied' | 'saveFailed'>;
}) {
  const [state, setState] = useState<'idle' | 'saving' | SaveHow>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const press = async () => {
    if (state === 'saving') return;
    setState('saving');
    const how = await saveRecordingToPhone({ src, filename: save.filename, kind: save.kind, recordingId: save.recordingId ?? null });
    setState(how);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), SAVE_HOLD_MS);
  };
  const said = state === 'saving' ? words.saving
    : state === 'failed' ? words.saveFailed
      : state === 'copied' ? words.saveLinkCopied
        : state === 'handoff' || state === 'app_browser' ? words.savedToPhone
          : null;
  return (
    <div className="flex flex-col gap-1 pt-1">
      <button type="button" onClick={() => { void press(); }} disabled={state === 'saving'} data-testid="save-to-phone"
        className={cn('flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border border-[#e5e7eb] bg-white px-3 text-[15px] font-semibold text-[#33374a] disabled:opacity-60', FOCUS)}>
        <Download className="h-5 w-5" aria-hidden="true" />{words.saveToPhone}
      </button>
      {said ? <p role="status" className={cn('m-0 text-center text-[13px]', state === 'failed' ? 'text-[#b45309]' : 'text-[#6b7280]')}>{said}</p> : null}
    </div>
  );
}
