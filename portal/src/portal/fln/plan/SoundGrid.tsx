import { useEffect, useMemo } from 'react';
import { Volume2 } from 'lucide-react';
import { gridClips } from '../player/clips';
import { useFlnPlayerContext } from '../player/useFlnPlayer';
import { SoundTile } from '../player/SoundTile';
import type { FlnPlanLike } from '../player/types';
import { audioStrings, audioDir } from '../strings.audio';
import '../player/player.css';

/**
 * "Sounds in this lesson" at the top of a plan (contracts/player.md v2): one tile per distinct clip in first-appearance
 * order, narrations last, RTL for an Urdu plan. Not drawn on a screener plan or a plan with no audio. Warms its clips
 * once when it mounts, so the first taps play from memory (A1/A2).
 */
export interface SoundGridProps { plan: FlnPlanLike; screener?: boolean }

export function SoundGrid({ plan, screener }: SoundGridProps) {
  const player = useFlnPlayerContext();
  const clips = useMemo(() => gridClips(plan), [plan]);
  const ids = useMemo(() => clips.map((c) => c.id), [clips]);
  const idsKey = ids.join('|');
  const show = !screener && ids.length > 0;

  useEffect(() => {
    if (show && player) player.warm(ids);
  }, [show, player, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- once per distinct clip list

  if (!show) return null;
  const s = audioStrings(plan.lang);
  const dir = audioDir(plan.lang, plan.dir);

  return (
    <section className="fln-snd fln-snd-grid" lang={plan.lang} dir={dir} aria-label={s.gridTitle}>
      <h3 className="fln-snd-grid__title">
        <Volume2 size={16} aria-hidden="true" focusable={false} />
        <span className="fln-snd-grid__name">{s.gridTitle}</span>
        <bdi className="fln-snd-grid__count">{clips.length}</bdi>
      </h3>
      <div className="fln-snd-grid__tiles">
        {clips.map((c) => (
          <SoundTile key={c.id} clipId={c.id} label={c.label} caption={c.caption} lang={plan.lang} dir={dir} role={c.role} />
        ))}
      </div>
    </section>
  );
}
