/**
 * The FLN sound player's public surface (contracts/player.md v2). m-app imports ONLY from here:
 *
 *   const player = useFlnPlayer(plan);                 // one per plan page; registers every clip, stops on hide
 *   <FlnPlayerProvider player={player}> … </FlnPlayerProvider>
 *   <SoundGrid plan={plan} screener={label === 'screener'} />   // warms its clips on mount
 *   <SoundPill clipId={c.id} label={c.label} caption={c.caption} lang={plan.lang} dir={plan.dir} />
 *   useWarmOnOpen(open, sectionClipIds(section));     // inside Section: warms its clips when it expands
 *   player.onEvent((e) => queue(e));                   // A12 telemetry → POST /api/portal/fln/events
 */
export type {
  Clip,
  ClipRole,
  FlnPlayer,
  FlnPlayerDeps,
  FlnPlanLike,
  FlnSectionLike,
  FlnMediaLike,
  PlayerEvent,
  PlayerState,
} from './types';
export { createFlnPlayer } from './FlnPlayer';
export { useFlnPlayer, useWarmOnOpen, useClipState, FlnPlayerProvider, useFlnPlayerContext } from './useFlnPlayer';
export { planClips, gridClips, sectionClipIds, itemClips, clipIdOf } from './clips';
export { SoundPill } from './SoundPill';
export { SoundTile } from './SoundTile';
export { SoundGrid } from '../plan/SoundGrid';
