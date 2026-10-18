import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FlnPlayerProvider } from '../player/useFlnPlayer';
import { SoundPill } from '../player/SoundPill';
import { SoundTile } from '../player/SoundTile';
import { SoundGrid } from '../plan/SoundGrid';
import type { FlnPlanLike, FlnPlayer, PlayerState, StateListener } from '../player/types';

// m-app 18 Oct 16:10Z: PlanPage passes its own owner (`section:group:item:index`) and draws the grid heading itself.

function fakePlayer() {
  const listeners = new Map<string, Set<StateListener>>();
  const toggles: Array<{ id: string; owner?: string }> = [];
  const player: FlnPlayer = {
    register() {}, warm() {}, stopAll() {}, dispose() {},
    toggle(id, owner) { toggles.push({ id, owner }); },
    subscribe(id, cb) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id)!.add(cb);
      cb('idle', 0);
      return () => { listeners.get(id)?.delete(cb); };
    },
    onEvent() { return () => {}; },
  };
  const emit = (id: string, s: PlayerState, owner?: string) => act(() => { listeners.get(id)?.forEach((cb) => cb(s, 0, owner)); });
  return { player, toggles, emit };
}

const plan: FlnPlanLike = {
  key: 'en-1', lang: 'en', dir: 'ltr',
  sections: [{ kind: 'explain', groups: [{ items: [{ text: 'Say **c**', media: [{ kind: 'audio', src: 'https://m.example/c.mp3', sha8: 'c001', label_en: 'c' }] }] }] }],
};

afterEach(() => cleanup());

describe('owner prop', () => {
  it('SoundPill passes the given owner to toggle, and only that owner sees playing', () => {
    const f = fakePlayer();
    render(
      <FlnPlayerProvider player={f.player}>
        <SoundPill clipId="c001" label="c" lang="en" owner="s1:g0:i2:0" />
        <SoundPill clipId="c001" label="c" lang="en" owner="s1:g0:i2:1" />
      </FlnPlayerProvider>,
    );
    const [a, b] = screen.getAllByRole('button');
    fireEvent.click(a);
    expect(f.toggles).toEqual([{ id: 'c001', owner: 's1:g0:i2:0' }]);
    f.emit('c001', 'playing', 's1:g0:i2:0');
    expect(a).toHaveAttribute('data-fln-state', 'playing');
    expect(b).toHaveAttribute('data-fln-state', 'idle');
  });

  it('SoundTile passes the given owner to toggle', () => {
    const f = fakePlayer();
    render(<FlnPlayerProvider player={f.player}><SoundTile clipId="c001" label="c" lang="en" owner="grid:0" /></FlnPlayerProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(f.toggles).toEqual([{ id: 'c001', owner: 'grid:0' }]);
  });
});

describe('SoundGrid heading', () => {
  it('draws no heading by default (PlanPage draws it above the grid)', () => {
    const f = fakePlayer();
    const { container } = render(<FlnPlayerProvider player={f.player}><SoundGrid plan={plan} /></FlnPlayerProvider>);
    expect(container.querySelector('h1,h2,h3,h4')).toBeNull();
    expect(container.querySelector('section')).toHaveAttribute('aria-label', 'Sounds in this lesson');
  });

  it('draws it when asked (the bench page)', () => {
    const f = fakePlayer();
    const { container } = render(<FlnPlayerProvider player={f.player}><SoundGrid plan={plan} heading /></FlnPlayerProvider>);
    expect(container.querySelector('h3')?.textContent).toContain('Sounds in this lesson');
  });
});
