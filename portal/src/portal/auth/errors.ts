/**
 * bd-fmf24g.64 — the server's English sentences become short in-app labels, chosen by HTTP status (the operator's
 * call, no API change). `field` says which input the message sits under; `form` is a plain message under the button.
 * 0 means no response at all (offline, the request never left). Anything unexpected is the generic "Couldn't …".
 *
 * Statuses read from dashboard/routes/portal.routes.js: /login answers 400 bad number, 401 wrong password, 403
 * PASSWORD_NOT_SET, 404 no account, 429 rate limit, 500 other; /request-reset 400/404/429/500; /verify-reset-code 400.
 */
import type { AuthKey } from './copy';

export type AuthError = { field: 'phone' | 'password' | 'confirm' | 'code' | 'form'; key: AuthKey };

/**
 * `byName`: she signed in with an account NAME (bd-s6qbts.5). The server answers every way that can be wrong with the
 * wrong-password 401 so it never says whether a name exists; "Wrong password" would point someone who mistyped the
 * NAME at the wrong field, so a name's 401 is the plain "Couldn't log in". Everything else maps as for a phone.
 */
export function loginFailure(status?: number, byName = false): AuthError {
  if (byName && status === 401) return { field: 'form', key: 'couldntLogin' };
  switch (status) {
    case 401: return { field: 'password', key: 'wrongPw' };
    case 403: return { field: 'password', key: 'noPw' };
    case 404: return { field: 'phone', key: 'noAccount' };
    case 400: return { field: 'phone', key: 'checkNum' };
    case 429: return { field: 'form', key: 'tooMany' };
    case 0: return { field: 'form', key: 'noConnection' };
    default: return { field: 'form', key: 'couldntLogin' };
  }
}

export function resetFailure(status?: number): AuthError {
  switch (status) {
    case 404: return { field: 'phone', key: 'noAccount' };
    case 400: return { field: 'phone', key: 'checkNum' };
    case 429: return { field: 'form', key: 'tooMany' };
    case 0: return { field: 'form', key: 'noConnection' };
    default: return { field: 'form', key: 'couldntSend' };
  }
}

export function verifyFailure(status?: number): AuthError {
  switch (status) {
    case 400: return { field: 'code', key: 'wrongCode' };
    case 429: return { field: 'form', key: 'tooMany' };
    case 0: return { field: 'form', key: 'noConnection' };
    default: return { field: 'form', key: 'couldntReset' };
  }
}

/** The HTTP status of a failed axios call; 0 when nothing answered. */
export function statusOf(error: unknown): number {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return typeof status === 'number' ? status : 0;
}
