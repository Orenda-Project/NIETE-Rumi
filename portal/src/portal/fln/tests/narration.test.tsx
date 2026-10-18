import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

/**
 * bd-t7zk3t.11 — a step's story narration reaches the audio lane's REAL SoundPill with its clip role, so the pill
 * says "Listen to the story" (audio 324bbfa0ed) instead of the file stem. No player mock: this is the seam itself.
 */
import { Move } from '../plan/Move';
import type { FlnMedia } from '../types';

afterEach(() => cleanup());

const A = 'https://media.example.org/fln/audio';
const narration: FlnMedia = { kind: 'audio', src: `${A}/n1/f_story.mp3`, orig: `${A}/o/f_story.mp3`, sha8: 'n1', role: 'narration' };

describe('Move → SoundPill role', () => {
  it('a narration pill says "Listen to the story"', () => {
    const { container } = render(
      <Move item={{ kind: 'instruction', text: 'Read the story aloud.', media: [narration] }} n={1} planLang="en" planDir="ltr" uiLang="en" />,
    );
    const pill = container.querySelector('[data-fln-clip]');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('Listen to the story');
  });
});
