import api from '../../services/api';

/**
 * bd-ik5e8j.4 — what the help entry reads and writes: GET /api/portal/help?lang= (her role's videos in the page's
 * language, and whether she has opened one before) and POST /api/portal/help/seen (once). Never throws.
 *
 * `seen` is also kept here for the page's life, so the moment she opens any help tray every "?" on screen stops
 * pulsing, before the server answers (subscribe / isSeenLocally).
 */
export type HelpFeature = 'start' | 'lessons' | 'coaching' | 'training';
export type HelpVideo = {
  feature: string;
  lang: 'en' | 'ur';
  title: string;
  url: string;
  urlSmall: string | null;
  poster: string | null;
  seconds: number | null;
  bytes: number | null;
};
export type HelpData = { seen: boolean; videos: HelpVideo[] };

const KEEP_MS = 60 * 1000;
let kept: { lang: string; at: number; read: Promise<HelpData | null> } | null = null;
let seenHere = false;
let posted = false;
const listeners = new Set<() => void>();

/** Her help, cached for a minute per language; null when it could not be read (the "?" then stays still). */
export function loadHelp(lang: string): Promise<HelpData | null> {
  if (kept && kept.lang === lang && Date.now() - kept.at < KEEP_MS) return kept.read;
  const read = api.get('/help', { params: { lang } })
    .then(({ data }) => (data && data.success ? { seen: data.seen === true, videos: Array.isArray(data.videos) ? data.videos : [] } : null))
    .catch(() => null);
  kept = { lang, at: Date.now(), read };
  return read;
}

/** She opened a help tray: every "?" stops at once; the server is told once per page life. */
export function markHelpSeen(): void {
  if (!seenHere) {
    seenHere = true;
    listeners.forEach((f) => f());
  }
  if (posted) return;
  posted = true;
  void api.post('/help/seen', {}).catch(() => { posted = false; });
}

export function isSeenLocally(): boolean {
  return seenHere;
}

export function subscribeSeen(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Tests only. */
export function resetHelp(): void {
  kept = null;
  seenHere = false;
  posted = false;
  listeners.clear();
}
