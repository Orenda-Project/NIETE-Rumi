/**
 * Dev-only screenshot page: every sound control in every state (served by Vite dev at
 * /src/portal/fln/player/bench/states.html?lang=en|ur; NOT in the production build, whose only input is index.html).
 * A fake player pins each clip to a state, so idle / loading / playing at 40 % / error can be shot side by side.
 * Fixtures are synthetic: a few graphemes, no plan text.
 */
import '@/index.css';
import { createRoot } from 'react-dom/client';
import { FlnPlayerProvider } from '../useFlnPlayer';
import { SoundPill } from '../SoundPill';
import { SoundTile } from '../SoundTile';
import { SoundGrid } from '../../plan/SoundGrid';
import type { FlnPlanLike, FlnPlayer, PlayerState } from '../types';

const STATES: PlayerState[] = ['idle', 'loading', 'playing', 'error'];
const lang = new URLSearchParams(window.location.search).get('lang') === 'ur' ? 'ur' : 'en';
const dir = lang === 'ur' ? 'rtl' : 'ltr';

/** Pins: clip id → [state, progress]. Ids not listed are idle. */
const pins = new Map<string, [PlayerState, number]>();
for (const s of STATES) {
  pins.set(`pill-${s}`, [s, 0.4]);
  pins.set(`tile-${s}`, [s, 0.4]);
  pins.set(`story-${s}`, [s, 0.4]);
}

const pinnedPlayer: FlnPlayer = {
  register() {},
  warm() {},
  toggle(id) { console.info('toggle', id); },
  stopAll() {},
  subscribe(id, cb) {
    const [s, p] = pins.get(id) || ['idle', 0];
    cb(s, p);
    return () => {};
  },
  onEvent() { return () => {}; },
  dispose() {},
};

const aud = (sha8: string, extra: Record<string, unknown>) => ({ kind: 'audio', src: `https://m.example/${sha8}.mp3`, sha8, ...extra });

const FIXTURE = {
  en: {
    pill: { label: 'c', caption: 'as in Cat' },
    tile: { label: 'c', caption: 'as in Cat' },
    plan: {
      lang: 'en', dir: 'ltr',
      sections: [{ kind: 'explain', groups: [{ items: [
        { media: [aud('grid-c', { label_en: 'c', caption_en: 'as in Cat' })] },
        { media: [aud('grid-k', { label_en: 'k', caption_en: 'as in Kite' })] },
        { media: [aud('grid-ck', { label_en: 'ck', caption_en: 'as in Duck' })] },
        { media: [aud('grid-story', { role: 'narration', label_en: 'story' })] },
      ] }] }],
    } as FlnPlanLike,
    gridPlaying: 'grid-k',
  },
  ur: {
    pill: { label: 'ب', caption: 'بطخ' },
    tile: { label: 'ب', caption: 'بطخ' },
    plan: {
      lang: 'ur', dir: 'rtl',
      sections: [{ kind: 'explain', groups: [{ items: [
        { media: [aud('grid-b', { label_ur: 'ب', caption_ur: 'بطخ' })] },
        { media: [aud('grid-m', { label_ur: 'م', caption_ur: 'مور' })] },
        { media: [aud('grid-n', { label_ur: 'ن' })] },
        { media: [aud('grid-a', { label_ur: 'ا', caption_ur: 'انار' })] },
        { media: [aud('grid-story', { role: 'narration', label_ur: 'کہانی' })] },
      ] }] }],
    } as FlnPlanLike,
    gridPlaying: 'grid-m',
  },
}[lang];
pins.set(FIXTURE.gridPlaying, ['playing', 0.4]);

const box = { display: 'grid', gridTemplateColumns: '1fr', gap: 10, padding: 16, maxWidth: 420, margin: '0 auto', background: '#fff' } as const;
const row = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 } as const;
const tag = { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#55606F', width: '100%', direction: 'ltr', textAlign: 'left' } as const;
const tiles = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8, width: '100%' } as const;

export function StatesPage() {
  return (
    <FlnPlayerProvider player={pinnedPlayer}>
      <main style={box} dir={dir}>
        {STATES.map((s) => (
          <div key={s} style={row} data-state-row={s}>
            <span style={tag} data-latin>{s}</span>
            <SoundPill clipId={`pill-${s}`} label={FIXTURE.pill.label} caption={FIXTURE.pill.caption} lang={lang} dir={dir} first={s === 'idle'} />
            <div style={tiles} dir={dir}>
              <SoundTile clipId={`tile-${s}`} label={FIXTURE.tile.label} caption={FIXTURE.tile.caption} lang={lang} dir={dir} />
              <SoundTile clipId={`story-${s}`} label="story" lang={lang} dir={dir} role="narration" />
            </div>
          </div>
        ))}
        <span style={tag} data-latin>grid</span>
        <SoundGrid plan={FIXTURE.plan} />
      </main>
    </FlnPlayerProvider>
  );
}

document.documentElement.lang = lang;
document.documentElement.dir = dir;
createRoot(document.getElementById('root')!).render(<StatesPage />);
(window as unknown as { __statesReady: boolean }).__statesReady = true;
