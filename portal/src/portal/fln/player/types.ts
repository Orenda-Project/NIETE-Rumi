/**
 * FLN sound player — the shapes it reads and the API it exposes (contracts/player.md v2, owner `audio`).
 * The player stands alone: it reads the plan structurally (only the fields below) and imports nothing from the
 * teacher kit, so m-app's PlanPage, the bench page and the tests all feed it the same way.
 */

/** A media object as the corpus bundle stores it (plan-json contract §Media). Only audio is used here. */
export interface FlnMediaLike {
  kind: string;
  src: string;
  orig?: string;
  sha8?: string;
  label?: string;
  label_en?: string;
  label_ur?: string;
  caption_en?: string;
  caption_ur?: string;
  role?: string;
  duration_s?: number;
  bytes?: number;
}

export interface FlnItemLike {
  kind?: string;
  text?: string;
  media?: FlnMediaLike[];
}

export interface FlnGroupLike {
  header?: string | null;
  items?: FlnItemLike[];
}

export interface FlnSectionLike {
  kind: string;
  groups?: FlnGroupLike[];
}

export interface FlnPlanLike {
  key?: string;
  id?: number;
  lang?: string;
  dir?: string;
  sections?: FlnSectionLike[];
  setup?: FlnItemLike[];
  homework?: FlnItemLike[];
  summary?: FlnItemLike[];
}

export type ClipRole = 'sound' | 'word' | 'narration';

export interface Clip {
  /** `sha8` when the bundle has it, else `src`. Two steps that use the same file share one clip. */
  id: string;
  /** The mirror URL (or the original before the mirror). Used exactly as given. */
  src: string;
  /** The original S3 URL; the fallback source. Equal to `src` before the mirror. */
  orig: string;
  /** What the control says: label_ur ?? label_en → first **bold** run of the owning step → filename stem. */
  label: string;
  /** The keyword ("as in Cat") when the bundle gives one. */
  caption?: string;
  role: ClipRole;
  duration_s?: number;
  bytes?: number;
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'error';

/** `result` names the source that played (`ok-mirror` | `ok-orig`) or why it failed (`error-<code>`). */
export interface PlayerEvent {
  kind: 'audio_play' | 'audio_error';
  clip: string;
  ms?: number;
  result?: string;
}

export type StateListener = (state: PlayerState, progress01: number, owner?: string) => void;

export interface FlnPlayer {
  /** The page registers every clip once (grid + sections). Re-registering an id is a no-op. */
  register(clips: Clip[]): void;
  /** Prefetch in order, one <audio preload="auto"> per clip, 2 at a time; the first 3 queue now, the rest at idle; ≤1.5 MB. */
  warm(ids: string[]): void;
  /**
   * MUST be called inside the tap handler. idle → play from 0 (stops any other); playing/loading → stop;
   * error → retry. `owner` tells two controls of the same clip apart (a drill's repeats each keep their own state).
   */
  toggle(id: string, owner?: string): void;
  /** Stops whatever plays. The hook binds it to pagehide / visibilitychange hidden / freeze. */
  stopAll(): void;
  /** Called at once with the current state, then on every change. Returns the unsubscribe. */
  subscribe(id: string, cb: StateListener): () => void;
  /** Telemetry for the events batch (m-app posts it to /api/portal/fln/events). Returns the unsubscribe. */
  onEvent(cb: (e: PlayerEvent) => void): () => void;
  /** Releases elements, their buffers and timers. */
  dispose(): void;
}

/** The network/clock seams. Production passes nothing; tests and the bench pass fakes. */
export interface FlnPlayerDeps {
  createAudio?: () => HTMLAudioElement;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  requestIdle?: (fn: () => void) => void;
  /** Called once per mirror origin at register (default: <link rel=preconnect> ×2). */
  preconnect?: (origin: string) => void;
  /** Overrides for the timing rules (defaults: firstByteMs 2500, giveUpMs 6000, stallMs 3000, ceilingMs 20000, warmNow 3, budgetBytes 1.5 MB, warmConcurrency 2, warmStepMs 8000). */
  timing?: Partial<FlnPlayerTiming>;
}

export interface FlnPlayerTiming {
  firstByteMs: number;
  /** No `playing` this long after the tap → the retry state, unless bytes are still arriving (see stallMs). */
  giveUpMs: number;
  /** While loading, the give-up waits until this long after the last byte (a big clip still downloading is not failed). */
  stallMs: number;
  /** The give-up never waits past this, bytes or not (a trickle must not spin forever). */
  ceilingMs: number;
  warmNow: number;
  budgetBytes: number;
  /** Clips warming at once, in order (the first `warmNow` start without waiting for idle). */
  warmConcurrency: number;
  /** A clip whose head has not arrived by then stops holding the queue (it keeps loading). */
  warmStepMs: number;
}
