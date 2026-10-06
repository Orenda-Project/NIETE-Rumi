/**
 * A session that came from the link on the training template.
 *
 * The bot sends Training as a template whose button opens /t/<token> in
 * WhatsApp's own browser; the portal turns that into a session scoped to
 * training (dashboard/routes/training-link.routes.js), and /dashboard reports
 * it as sessionScope 'training'. Such a session can read training and nothing
 * else, so the portal shows training only, and when it runs out she goes back
 * to the link page (/t: "open Training again in WhatsApp"), not to a password
 * login — many teachers never set one.
 *
 * Remembered for this tab only (sessionStorage), so the 401 that ends the
 * session still knows where to send her. Storage can be unavailable; then it
 * simply is not remembered.
 */
const KEY = 'niete_training_link';

export const TRAINING_HOME = '/portal/training';
export const LINK_EXPIRED_PAGE = '/t';

export function isTrainingLinkUser(user: { sessionScope?: string | null } | null | undefined): boolean {
  return !!user && user.sessionScope === 'training';
}

export function isTrainingPath(pathname: string): boolean {
  return pathname === TRAINING_HOME || pathname.startsWith(`${TRAINING_HOME}/`);
}

export function rememberLinkSession(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: not remembered */
  }
}

export function isLinkSession(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
