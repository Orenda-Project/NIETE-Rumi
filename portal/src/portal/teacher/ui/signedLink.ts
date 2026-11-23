/**
 * bd-r24965 (queue #239) — signed R2 links as the players see them: is a new link the same recording, and is a link at
 * its end. Kept out of AudioCard.tsx so that file exports components only (fast refresh).
 */

/**
 * bd-r24965 (queue #239) — the same recording behind a newly signed link. The visit page asks for the observation again
 * every 10 s while the Digital Coach works (and whenever the tab comes back), Debrief asks again while it listens, and
 * every answer signs the R2 link afresh (a new X-Amz-Date and X-Amz-Signature). Both links signed, same origin and path:
 * the same file. A plain link whose query differs is NOT assumed to be the same file; a blob is only ever itself.
 */
export function sameRecording(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const signed = (u: URL) => u.searchParams.has('X-Amz-Signature');
    return /^https?:$/.test(x.protocol) && x.origin === y.origin && x.pathname === y.pathname && signed(x) && signed(y);
  } catch { return false; }
}

/**
 * bd-r24965 — true when a signed link is past, or within two minutes of, the end it was signed for (X-Amz-Date +
 * X-Amz-Expires). Chrome never says so itself: R2's 403 is XML, Chrome's ORB blocks it, and the player only stalls.
 */
export function nearItsEnd(url?: string | null, now = Date.now()): boolean {
  if (!url) return false;
  try {
    const q = new URL(url).searchParams;
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(q.get('X-Amz-Date') || '');
    const life = Number(q.get('X-Amz-Expires'));
    if (!m || !Number.isFinite(life)) return false;
    const signedAt = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return now > signedAt + life * 1000 - 120_000;
  } catch { return false; }
}
