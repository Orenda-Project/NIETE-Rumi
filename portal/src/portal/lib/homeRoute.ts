import { isLeader, type RoleUserLike } from './leaderRole';
import { SCHOOLS_PATH, isSchoolsTab } from '../analytics/tabs';

/**
 * bd-s6qbts.3 — where a signed-in user belongs. ONE place, used by the sign-in form, "/", the password-reset login
 * and the guard around every route (analytics/AnalyticsOnlyGuard).
 *
 * An analytics-only account (users.analyticsOnly, from app_settings.portal_analytics_only) sees the schools analytics
 * page and nothing else of the portal. Everyone else keeps exactly the home they had: the school-leader family on
 * My Patch, anyone else on the dashboard — and the analytics page is not theirs.
 */
export const ANALYTICS_HOME = SCHOOLS_PATH;

export interface HomeUserLike extends RoleUserLike {
  analyticsOnly?: boolean | null;
}

/** Only a literal true: a missing or malformed flag is an ordinary account, never a locked-in one. */
export function isAnalyticsOnly(user?: HomeUserLike | null): boolean {
  return user?.analyticsOnly === true;
}

export function homeFor(user?: HomeUserLike | null): string {
  if (isAnalyticsOnly(user)) return ANALYTICS_HOME;
  return isLeader(user) ? '/portal/leader' : '/portal/dashboard';
}

/**
 * Pages an analytics-only account may still open: the signed-out pages. Sign-in and the setup link (how the account
 * is first opened), password reset, the privacy policy, and Google Play's account-deletion page. Each one works for
 * a signed-out visitor and shows nothing of a teacher's or a leader's portal.
 *
 * NOT /portal/account: the page itself is neutral, but it stands in the teacher/leader frame (their menu), so for
 * this account it would be a door back into pages it cannot use. Log out is on the analytics page itself.
 */
const OPEN_TO_ANALYTICS_ONLY = [
  /^\/portal\/login\/?$/,
  /^\/portal\/setup\//,
  /^\/portal\/reset-password(\/|$)/,
  /^\/portal\/privacy\/?$/,
  /^\/portal\/delete-account\/?$/,
];

const trimmed = (pathname: string) => pathname.replace(/\/+$/, '');

/**
 * bd-97x22y.2 — the page and each of its tabs (/portal/analytics/schools/<tab>, analytics/tabs.ts). An address under
 * it that is not a tab is not her page: the gate sends her to the page itself.
 */
const isAnalyticsPage = (pathname: string) => {
  const p = trimmed(pathname);
  if (p === ANALYTICS_HOME) return true;
  return p.startsWith(`${ANALYTICS_HOME}/`) && isSchoolsTab(p.slice(ANALYTICS_HOME.length + 1));
};

/** The page, a tab of it, or any other address under it: none of it is anyone else's. */
const isUnderAnalyticsPage = (pathname: string) => {
  const p = trimmed(pathname);
  return p === ANALYTICS_HOME || p.startsWith(`${ANALYTICS_HOME}/`);
};
const isPortalPath = (pathname: string) => pathname === '/portal' || pathname.startsWith('/portal/');

/**
 * Where this user must go instead of `pathname`, or null to stay. Null while nobody is signed in: the pages send a
 * signed-out visitor to sign in themselves, as before. Outside /portal (the marketing site, "/") nothing is decided
 * here — "/" resolves the session itself (PortalRoot, through homeFor).
 */
export function redirectFor(user: HomeUserLike | null | undefined, pathname: string): string | null {
  if (!user || !isPortalPath(pathname)) return null;
  if (isAnalyticsOnly(user)) {
    if (isAnalyticsPage(pathname) || OPEN_TO_ANALYTICS_ONLY.some((re) => re.test(pathname))) return null;
    return ANALYTICS_HOME;
  }
  return isUnderAnalyticsPage(pathname) ? homeFor(user) : null;
}
