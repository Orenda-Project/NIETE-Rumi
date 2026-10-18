import type { FlnPlayer, FlnPlayerDeps } from './types';

/** STUB (contract only) — replaced by the implementation in this PR. Does nothing. */
export function createFlnPlayer(_deps: FlnPlayerDeps = {}): FlnPlayer {
  return {
    register() {},
    warm() {},
    toggle() {},
    stopAll() {},
    subscribe(_id, cb) { cb('idle', 0); return () => {}; },
    onEvent() { return () => {}; },
    dispose() {},
  };
}
