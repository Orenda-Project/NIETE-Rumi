/**
 * bd-fxk3t8 — which frame this device showed last: the teacher app v2's, or the classic one.
 *
 * Read before anything is known about the user — by index.html's static shell (before the
 * app's JS arrives) and by the placeholder frame the app draws while the user loads — so the
 * first thing on screen is the frame she is about to get, not a white page or a spinner.
 *
 * It is only a picture hint. No feature decision reads it: TeacherGate and the menus still
 * wait for the real flag. It holds no personal data, and it is cleared when she logs out or
 * the session is gone, so a signed-out device boots to the sign-in outline.
 */
export type ShellHint = "teacher" | "classic";

/** The key index.html reads too — keep them the same. */
export const SHELL_HINT_KEY = "niete:shell";

export function readShellHint(): ShellHint | null {
  try {
    const v = window.localStorage.getItem(SHELL_HINT_KEY);
    return v === "teacher" || v === "classic" ? v : null;
  } catch {
    return null;
  }
}

export function writeShellHint(hint: ShellHint): void {
  try {
    if (window.localStorage.getItem(SHELL_HINT_KEY) !== hint) window.localStorage.setItem(SHELL_HINT_KEY, hint);
  } catch {
    /* storage blocked: the classic outline next time */
  }
}

export function clearShellHint(): void {
  try {
    window.localStorage.removeItem(SHELL_HINT_KEY);
  } catch {
    /* nothing to clear */
  }
}
