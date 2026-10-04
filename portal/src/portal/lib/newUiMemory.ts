/**
 * bd-5rz1v.12 / bd-5rz1v.26.4 — the last portal_new_ui answer, for the user it was read for. Memory
 * only, never stored, never carried to another user.
 *
 * Its own module, with no API client: useNewUi (which reads /config) writes it, and the recording
 * session reads it outside a component — to ask "Stop recording?" in the look of the menu she
 * tapped Logout in — without loading the portal's services (tests that mock the runtime would
 * otherwise have to know about it).
 */
let remembered: { userKey: string; on: boolean } | null = null;

export function rememberNewUi(userKey: string, on: boolean): void {
  remembered = { userKey, on };
}

/** The remembered answer for this user, or null (another user, or nothing read yet). */
export function rememberedNewUiFor(userKey: string | null | undefined): boolean | null {
  return userKey && remembered && remembered.userKey === userKey ? remembered.on : null;
}

/**
 * True only when /config last said `true` for the user signed in now (every page's layout asks
 * with her key). Nothing read yet, or "off", is false: anything that branches on it fails closed to
 * the old look.
 */
export function newUiRemembered(): boolean {
  return remembered?.on === true;
}

export function forgetNewUi(): void {
  remembered = null;
}
