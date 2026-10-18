import { useId, type CSSProperties } from 'react';
import { useClipState, useFlnPlayerContext } from './useFlnPlayer';
import { SoundStateIcon } from './SoundPill';
import type { ClipRole } from './types';
import { audioActionFor, audioActionLabel, audioStateText, audioStrings, audioDir } from '../strings.audio';
import './player.css';

/**
 * One tile of "Sounds in this lesson" (DESIGN_v2 §6): the grapheme big (EN `ck`, UR «ب» in Nastaliq), the keyword
 * caption under it, ≥56×56. A narration tile spans two columns and says "Listen to the story". Same four states and
 * attributes as SoundPill; the state line replaces the caption while loading / playing / failed.
 */
export interface SoundTileProps { clipId: string; label: string; caption?: string; lang?: string; dir?: string; role?: ClipRole; owner?: string }

export function SoundTile({ clipId, label, caption, lang, dir, role, owner: ownerProp }: SoundTileProps) {
  const player = useFlnPlayerContext();
  const autoOwner = useId();
  const owner = ownerProp ?? autoOwner;
  const { state, progress } = useClipState(clipId, owner);
  const narration = role === 'narration';
  const main = narration ? audioStrings(lang).listenStory : label;
  const sub = audioStateText(lang, state) ?? caption;
  const onClick = () => { player?.toggle(clipId, owner); };
  const bar = { '--fln-snd-p': `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` } as CSSProperties;

  return (
    <button
      type="button"
      className={`fln-snd fln-snd-tile${narration ? ' fln-snd-tile--wide' : ''}`}
      lang={lang}
      dir={audioDir(lang, dir)}
      data-fln-clip={clipId}
      data-fln-state={state}
      data-fln-role={role || 'sound'}
      aria-pressed={state === 'playing'}
      aria-busy={state === 'loading' || undefined}
      aria-label={audioActionLabel(lang, audioActionFor(state), main)}
      onClick={onClick}
    >
      <span className="fln-snd__corner"><SoundStateIcon state={state} size={narration ? 18 : 13} /></span>
      <bdi className={narration ? 'fln-snd__story' : 'fln-snd__g'}>{main}</bdi>
      {sub ? <span className="fln-snd__sub">{sub}</span> : null}
      {state === 'playing' ? <span className="fln-snd__bar" style={bar} aria-hidden="true"><b /></span> : null}
    </button>
  );
}
