/**
 * bd-t7zk3t.12 — where sign-in may send the user back to (`/portal/login?next=…`, contracts/deep-link.md v2).
 *
 * Only a same-origin PATH under `/portal/fln/` or `/portal/teacher/` is kept; everything else is `null`, and the caller
 * goes to the user's home as before. Refused: other origins (`//host`, `/\host`, `\\host`), any scheme (`https:`,
 * `javascript:`, `data:`), control and line-separator characters, a backslash anywhere, `..` segments, and the same
 * tricks percent-encoded once or twice (`%2F%2F`, `%5C`, `%252F`). A malformed escape is refused, not repaired.
 */
const ALLOW = /^\/portal\/(fln|teacher)\//;
const MAX_LEN = 2048;
// C0 controls, DEL, C1 controls, and the Unicode line/paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function layerIsSafe(s: string): boolean {
  if (CONTROL.test(s)) return false;
  if (s.includes('\\')) return false;
  if (SCHEME.test(s)) return false;
  if (!s.startsWith('/') || s.startsWith('//')) return false;
  // `//` anywhere in the path (not the query) is an origin or a doubled segment a router could read as one.
  const path = s.split(/[?#]/, 1)[0];
  if (path.includes('//')) return false;
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) return false;
  return true;
}

export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LEN) return null;
  // Check the value as given and as it reads after one and two rounds of decoding.
  let layer = raw;
  for (let i = 0; i < 3; i += 1) {
    if (!layerIsSafe(layer)) return null;
    let next: string;
    try {
      next = decodeURIComponent(layer);
    } catch {
      return null;
    }
    if (next === layer) break;
    layer = next;
  }
  if (!layerIsSafe(layer)) return null;
  let u: URL;
  try {
    u = new URL(raw, 'https://same-origin.invalid');
  } catch {
    return null;
  }
  if (u.origin !== 'https://same-origin.invalid') return null;
  if (!ALLOW.test(u.pathname) || !ALLOW.test(raw)) return null;
  return `${u.pathname}${u.search}${u.hash}`;
}
