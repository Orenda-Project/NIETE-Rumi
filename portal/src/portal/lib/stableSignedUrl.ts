import { useRef } from "react";

/**
 * bd-ymavij — a signed link that does not change under a player. A polled endpoint signs the same file again on every
 * answer (a new X-Amz-Date, so a new string), and <audio src> reloads on every change — a tap just before a refresh,
 * or a play in progress, is thrown away. Keep the link while it points at the same file; take the new one when the
 * file changes, or once the kept one is old enough to be near its expiry (links are signed for an hour).
 */
export const STABLE_URL_MAX_AGE_MS = 45 * 60_000;

const fileOf = (url: string) => url.split("?")[0];

export function useStableSignedUrl(
  url: string | null | undefined,
  { now = Date.now, maxAgeMs = STABLE_URL_MAX_AGE_MS }: { now?: () => number; maxAgeMs?: number } = {},
): string | undefined {
  const kept = useRef<{ url: string; at: number } | null>(null);
  if (!url) {
    kept.current = null;
    return undefined;
  }
  const k = kept.current;
  if (!k || fileOf(k.url) !== fileOf(url) || now() - k.at >= maxAgeMs) {
    kept.current = { url, at: now() };
  }
  return kept.current!.url;
}
