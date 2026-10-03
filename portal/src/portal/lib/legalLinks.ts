/**
 * bd-3wb0s — the two links Google Play's User Data policy requires the app to
 * carry, in one place, so the nav, the login footer and the deletion page
 * cannot drift apart.
 *
 * The privacy policy is Taleemabad's own page (operator decision, 2026-10-03):
 * NIETE's app and portal are operated by Orenda Welfare Trust (Taleemabad), and
 * that page is the policy of record. It is EXTERNAL — opened with
 * `target="_blank"` so it leaves the app: the Android app's allowNavigation
 * only covers the portal host, so Capacitor hands any other host to the system
 * browser rather than loading it inside the WebView.
 *
 * Account deletion is the portal's own PUBLIC page — Play needs a URL that
 * works without the app and without signing in.
 */

export const PRIVACY_POLICY_URL = 'https://taleemabad.com/privacy-policy/';

/** Spread onto an <a> that opens the privacy policy outside the app. */
export const EXTERNAL_LINK_PROPS = { target: '_blank', rel: 'noopener noreferrer' } as const;

export const DELETE_ACCOUNT_PATH = '/portal/delete-account';

export const DELETION_EMAIL = 'info@taleemabad.com';
export const DELETION_SUBJECT = 'Delete my NIETE account';

/** mailto: with the subject filled in, and a body that asks for what we need to find her. */
export const DELETION_MAILTO =
  `mailto:${DELETION_EMAIL}?subject=${encodeURIComponent(DELETION_SUBJECT)}` +
  `&body=${encodeURIComponent('Registered phone number: \nName: \n')}`;
