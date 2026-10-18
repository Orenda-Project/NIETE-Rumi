import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createFlnPlayer } from './FlnPlayer';
import { planClips } from './clips';
import type { FlnPlanLike, FlnPlayer, FlnPlayerDeps, PlayerState } from './types';

/** STUB (contract only) — the hide/stop binding lands with the implementation. */
export function useFlnPlayer(plan: FlnPlanLike | null | undefined, deps?: FlnPlayerDeps): FlnPlayer {
  const player = useMemo(() => createFlnPlayer(deps), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (plan) player.register(planClips(plan)); }, [plan, player]);
  return player;
}

const Ctx = createContext<FlnPlayer | null>(null);

export function FlnPlayerProvider({ player, children }: { player: FlnPlayer; children?: ReactNode }) {
  return createElement(Ctx.Provider, { value: player }, children);
}

export function useFlnPlayerContext(): FlnPlayer | null {
  return useContext(Ctx);
}

/** Warms `ids` when `open` turns true (a Section calls it with its own clip ids). */
export function useWarmOnOpen(open: boolean, ids: string[]): void {
  const player = useFlnPlayerContext();
  const key = ids.join('|');
  useEffect(() => { if (open && player && ids.length) player.warm(ids); }, [open, key, player]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The live state of one clip as seen by one control. */
export function useClipState(id: string, owner?: string): { state: PlayerState; progress: number } {
  const player = useFlnPlayerContext();
  const [s, set] = useState<{ state: PlayerState; progress: number }>({ state: 'idle', progress: 0 });
  useEffect(() => {
    if (!player) return undefined;
    return player.subscribe(id, (state, progress, who) => {
      const mine = !who || !owner || who === owner;
      set(mine ? { state, progress } : { state: 'idle', progress: 0 });
    });
  }, [player, id, owner]);
  return s;
}
