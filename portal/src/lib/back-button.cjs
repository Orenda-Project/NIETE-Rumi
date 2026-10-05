/**
 * Android hardware back key — what one press should do.
 *
 * Without handling, the key falls through to Android's default, which leaves
 * the app from ANY page: three screens deep in Training, back drops her out to
 * the home screen. BackButtonHandler asks this function instead.
 *
 * The rule, in order:
 *   1. An open dialog, sheet or menu closes first (as Escape would).
 *   2. On a home page back leaves the app, even with history behind it —
 *      "back" from the dashboard to the login form she just submitted, or to a
 *      page she left, is not what back means there.
 *   3. Anywhere else, back goes to the previous page.
 *   4. With nothing behind (she arrived from a tapped link), back leaves the
 *      app, which returns her to wherever she tapped it — usually WhatsApp.
 *   5. bd-5rz1v.10 — EXCEPT while a lesson is recording (`recordingPath` is its
 *      screen). Leaving puts the app in the background, where Android gives it
 *      silence from the microphone, so the back that would leave (2 or 4) goes
 *      to the recording instead — or, on the recording itself, stays. Back
 *      with a page behind it (3) is unchanged: it is not trapped.
 *
 * Kept as CommonJS with no imports so the same file is testable under the
 * repo's Jest runner and consumable by Vite (same as app-target.cjs).
 */

/** The pages back leaves the app from: teacher home, leader home, signed out. */
const HOME_PATHS = ['/', '/portal/login', '/portal/dashboard', '/portal/leader'];

/** An open Radix overlay — dialog/sheet, alert dialog, dropdown menu, select list. */
const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ');

function normalisePath(path) {
  if (typeof path !== 'string' || !path) return '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * @param {object}  [opts]
 * @param {string}  [opts.path]           location.pathname
 * @param {boolean} [opts.canGoBack]      the WebView has a previous page
 * @param {boolean} [opts.overlayOpen]    a dialog/sheet/menu is open
 * @param {string|null} [opts.recordingPath] the screen of a lesson still recording, if any
 * @returns {'close-overlay'|'leave-app'|'history-back'|'to-recording'|'stay'}
 */
function resolveBackAction({ path, canGoBack = false, overlayOpen = false, recordingPath = null } = {}) {
  if (overlayOpen) return 'close-overlay';
  const leaves = HOME_PATHS.includes(normalisePath(path)) || !canGoBack;
  if (!leaves) return 'history-back';
  if (recordingPath) {
    return normalisePath(path) === normalisePath(recordingPath) ? 'stay' : 'to-recording';
  }
  return 'leave-app';
}

module.exports = { HOME_PATHS, OVERLAY_SELECTOR, resolveBackAction };
