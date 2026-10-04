/**
 * bd-3wb0s — the two links Google Play's User Data policy requires the app to
 * carry, in one place, so the nav, the login footer and the deletion page
 * cannot drift apart.
 *
 * bd-nvnf2 — the privacy policy is the portal's own PUBLIC page. It used to be
 * taleemabad.com/privacy-policy/, and Play rejected the app ("Invalid Privacy
 * policy — App or developer details don't match") because that page never
 * names the app or the developer on the store listing. The policy page and the
 * deletion page both name the publisher from PUBLISHER below, which must match
 * Play Console > Developer account > About you exactly; change it there and
 * here together.
 *
 * Both pages are portal routes, so in the Android app they open inside the
 * WebView like any other screen, and on the web they work without the app and
 * without signing in, which is what Play checks.
 */

/** Play Console > App content > Privacy policy: https://portal.niete.edu.pk/portal/privacy */
export const PRIVACY_POLICY_PATH = '/portal/privacy';

export const DELETE_ACCOUNT_PATH = '/portal/delete-account';

export const DELETION_EMAIL = 'info@taleemabad.com';
export const DELETION_SUBJECT = 'Delete my NIETE account';

/** mailto: with the subject filled in, and a body that asks for what we need to find her. */
export const DELETION_MAILTO =
  `mailto:${DELETION_EMAIL}?subject=${encodeURIComponent(DELETION_SUBJECT)}` +
  `&body=${encodeURIComponent('Registered phone number: \nName: \n')}`;

/** How long a deletion request takes, as both pages state it. */
export const DELETION_DAYS = 30;

/** The Play listing's identity, as Play Console shows it (operator, 2026-10-04). */
export const PUBLISHER = {
  appName: 'NIETE',
  packageName: 'pk.edu.niete',
  developerName: 'NIETE',
  legalEntity: 'ORENDA PRIVATE LIMITED',
  address: '134, Street 7, PMCHS, E-11/2, Islamabad 44000, Pakistan',
} as const;
