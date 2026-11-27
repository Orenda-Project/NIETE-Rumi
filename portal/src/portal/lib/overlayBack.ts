/**
 * bd-kijmb8 (queue #318) — "a layer is open over this page". The Lesson plan sheet registers here while it is open;
 * the coach recorder's Back guard (useRecordingBackGuard) reads it so the Back that CLOSES the sheet is not mistaken for a
 * request to leave the recording ("Finish recording?" is asked by the next Back, as today).
 *
 * The count drops one tick AFTER the sheet is gone, so the guard's popstate listener — which may run before or after the
 * sheet's own — always still sees the layer for the Back that closed it.
 */
let open = 0;

export const overlayOpen = (): boolean => open > 0;

export function registerOverlay(): () => void {
  open += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    setTimeout(() => { open = Math.max(0, open - 1); }, 0);
  };
}
