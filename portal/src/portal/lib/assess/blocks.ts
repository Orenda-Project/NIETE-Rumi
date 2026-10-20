/**
 * Which part of the battery a child takes, chosen on the phone. Each Pakistan day
 * starts on the next block (B1..B5), and the children of one visit take different
 * blocks, so a visit of five covers the whole battery. The coach can give one
 * child the whole battery instead ('full').
 */

export const BLOCKS = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
export type Block = (typeof BLOCKS)[number] | 'full';

const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Index into BLOCKS of today's (Pakistan) first block. */
export function startIndex(now = Date.now()): number {
  return Math.floor((now + PKT_OFFSET_MS) / DAY_MS) % BLOCKS.length;
}

/**
 * The block for the next child, given the blocks other children of this visit
 * already have: the first unused one from today's start; when all are used, the
 * least used.
 */
export function pickBlock(used: readonly string[], opts: { now?: number; full?: boolean } = {}): Block {
  if (opts.full) return 'full';
  const start = startIndex(opts.now ?? Date.now());
  const count = (b: string) => used.filter((u) => u === b).length;
  let best: Block = BLOCKS[start];
  for (let i = 0; i < BLOCKS.length; i += 1) {
    const b = BLOCKS[(start + i) % BLOCKS.length];
    if (count(b) < count(best)) best = b;
  }
  return best;
}

export function isBlock(v: unknown): v is Block {
  return v === 'full' || (BLOCKS as readonly unknown[]).includes(v);
}
