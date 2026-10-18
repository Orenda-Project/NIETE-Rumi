import { useId, type CSSProperties } from 'react';
import { Loader2, Play, RotateCcw, Square } from 'lucide-react';
import { useClipState, useFlnPlayerContext } from './useFlnPlayer';
import type { ClipRole, PlayerState } from './types';
import { audioActionFor, audioActionLabel, audioStateText, audioStrings, audioDir } from '../strings.audio';
import './player.css';

/**
 * One sound control inside a step (contracts/player.md v2, DESIGN_v2 §5). A real <button>, ≥48 px tall.
 * idle ▶ · loading ring + "Loading…" · playing ■ + progress bar + "Playing…" · error ↻ + the retry line.
 * The state is never colour alone (A10): every state changes the icon AND the text.
 */
export interface SoundPillProps {
  clipId: string; label: string; caption?: string; lang?: string; dir?: string; first?: boolean;
  /** Tells two controls of one clip apart (PlanPage: `section:group:item:index`). Default: a per-control id. */
  owner?: string;
  /** A narration says "Listen to the story" whatever its label (most narrations carry none: the stem is a filename). */
  role?: ClipRole;
}

/** The leading glyph for a state. ▶ keeps pointing right in both languages (the media convention). */
export function SoundStateIcon({ state, size = 18 }: { state: PlayerState; size?: number }) {
  const common = { size, 'aria-hidden': true, focusable: false, className: 'fln-snd__glyph' } as const;
  if (state === 'loading') return <Loader2 {...common} className="fln-snd__glyph fln-snd__spin" />;
  if (state === 'playing') return <Square {...common} fill="currentColor" strokeWidth={0} />;
  if (state === 'error') return <RotateCcw {...common} strokeWidth={2.6} />;
  return <Play {...common} fill="currentColor" strokeWidth={0} />;
}

/** iPhone/iPad, including iPadOS that reports itself as a Mac but has touch. */
function onIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

export function SoundPill({ clipId, label: givenLabel, caption, lang, dir, first, owner: ownerProp, role }: SoundPillProps) {
  const player = useFlnPlayerContext();
  const autoOwner = useId();
  const owner = ownerProp ?? autoOwner;
  const { state, progress } = useClipState(clipId, owner);
  const s = audioStrings(lang);
  const label = role === 'narration' ? s.listenStory : givenLabel;
  const textDir = audioDir(lang, dir);
  const stateText = audioStateText(lang, state);
  // The gesture must reach the player untouched: nothing awaited before toggle (the in-app browser needs it).
  const onClick = () => { player?.toggle(clipId, owner); };
  const sub = state === 'error' ? stateText : stateText ?? caption;
  const bar = { '--fln-snd-p': `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` } as CSSProperties;

  const button = (
    <button
      type="button"
      className="fln-snd fln-snd-pill"
      lang={lang}
      dir={textDir}
      data-fln-clip={clipId}
      data-fln-state={state}
      aria-pressed={state === 'playing'}
      aria-busy={state === 'loading' || undefined}
      aria-label={audioActionLabel(lang, audioActionFor(state), label)}
      onClick={onClick}
    >
      <span className="fln-snd__icon"><SoundStateIcon state={state} /></span>
      <span className="fln-snd__text">
        <bdi className="fln-snd__label">{label}</bdi>
        {sub ? <span className="fln-snd__sub">{sub}</span> : null}
      </span>
      {state === 'playing' ? <span className="fln-snd__bar" style={bar} aria-hidden="true"><b /></span> : null}
    </button>
  );

  if (!first || !onIOS()) return button;
  return (
    <span className="fln-snd fln-snd-wrap" lang={lang} dir={textDir}>
      {button}
      <span className="fln-snd__hint">{s.iosHint}</span>
    </span>
  );
}
