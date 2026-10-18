/**
 * bd-t7zk3t.11 — tiny stand-ins for the audio lane's SoundPill / SoundGrid (their files are contract stubs that render
 * null) and a fake player with spies. The REAL `itemClips` / `sectionClipIds` / `gridClips` (the label chain) are kept.
 *
 *   vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));
 */
import { useEffect, useState, type ReactNode } from 'react';
import { vi } from 'vitest';

type Listener = (s: string, p: number) => void;

export const warmOnOpen = vi.fn<(open: boolean, ids: string[]) => void>();
export const eventSinks: Array<(e: { kind: string; clip: string; ms?: number; result?: string }) => void> = [];
const subs = new Map<string, Set<Listener>>();
let playing: string | null = null;

export const fakePlayer = {
  register: vi.fn(),
  warm: vi.fn(),
  stopAll: vi.fn(),
  dispose: vi.fn(),
  toggle: vi.fn((id: string) => {
    const prev = playing;
    playing = prev === id ? null : id;
    if (prev) subs.get(prev)?.forEach((cb) => cb('idle', 0));
    if (playing) subs.get(playing)?.forEach((cb) => cb('playing', 0));
  }),
  subscribe: vi.fn((id: string, cb: Listener) => {
    if (!subs.has(id)) subs.set(id, new Set());
    subs.get(id)!.add(cb);
    cb(playing === id ? 'playing' : 'idle', 0);
    return () => { subs.get(id)?.delete(cb); };
  }),
  onEvent: vi.fn((cb: (e: { kind: string; clip: string }) => void) => {
    eventSinks.push(cb);
    return () => { const i = eventSinks.indexOf(cb); if (i >= 0) eventSinks.splice(i, 1); };
  }),
};

export const useFlnPlayerSpy = vi.fn();

export function resetPlayerMock() {
  warmOnOpen.mockClear();
  useFlnPlayerSpy.mockClear();
  Object.values(fakePlayer).forEach((f) => (f as ReturnType<typeof vi.fn>).mockClear());
  eventSinks.length = 0;
  subs.clear();
  playing = null;
}

function StandInPill({ clipId, label }: { clipId: string; label: string }) {
  const [s, set] = useState('idle');
  useEffect(() => fakePlayer.subscribe(clipId, (st) => set(st)), [clipId]);
  return (
    <button type="button" data-fln-clip={clipId} data-state={s} onClick={() => fakePlayer.toggle(clipId)}>
      <bdi>{label}</bdi>
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withStandIns(actual: any) {
  return {
    ...actual,
    useFlnPlayer: (plan: unknown) => { useFlnPlayerSpy(plan); return fakePlayer; },
    FlnPlayerProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useWarmOnOpen: (open: boolean, ids: string[]) => warmOnOpen(open, ids),
    SoundPill: StandInPill,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SoundGrid: ({ plan, screener }: { plan: any; screener?: boolean }) => {
      if (screener) return null;
      const clips = actual.gridClips(plan);
      if (!clips.length) return null;
      return (
        <div data-testid="fln-sound-grid" dir={plan.dir}>
          {clips.map((c: { id: string; label: string }) => <StandInPill key={c.id} clipId={c.id} label={c.label} />)}
        </div>
      );
    },
  };
}
