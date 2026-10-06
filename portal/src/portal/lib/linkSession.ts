/**
 * A session that came from the link on a template's button.
 *
 * The bot sends an area of the portal (training, lesson plans) as a template
 * whose button opens /t/<token> in WhatsApp's own browser; the portal turns that
 * into a session scoped to that area (dashboard/routes/portal-link.routes.js),
 * and /dashboard reports it as sessionScope. Such a session can read its area and
 * nothing else, so the portal shows that area only, and when it runs out she
 * goes back to the link page (/t: "open it again from the menu"), not to a
 * password login — many teachers never set one.
 *
 * AREAS mirrors the server's: where each area lives in the app. An area this app
 * does not know shows nothing and goes to the link page.
 *
 * Remembered for this tab only (sessionStorage), so the 401 that ends the
 * session still knows where to send her. Storage can be unavailable; then it
 * simply is not remembered.
 */
const KEY = 'niete_training_link';

const AREAS: Record<string, { home: string }> = {
  training: { home: '/portal/training' },
  lessons: { home: '/portal/curriculum' },
};

export const LINK_EXPIRED_PAGE = '/t';

/** The area of a link session, or null for a password login. */
export function linkArea(user: { sessionScope?: string | null } | null | undefined): string | null {
  return (user && user.sessionScope) || null;
}

/** Where an area lives in the app, or null for an area this app does not know. */
export function areaHome(area: string): string | null {
  return Object.prototype.hasOwnProperty.call(AREAS, area) ? AREAS[area].home : null;
}

export function isAreaPath(area: string, pathname: string): boolean {
  const home = areaHome(area);
  return !!home && (pathname === home || pathname.startsWith(`${home}/`));
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
