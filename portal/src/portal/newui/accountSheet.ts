import { useSyncExternalStore } from 'react';

/**
 * bd-5rz1v.17 — whether her account sheet is open, shared by everything that shows her avatar.
 *
 * The sheet itself belongs to the menu (NewUiNavigation): one sheet, wherever she taps her
 * initials — the slim strip, the desktop bar, or a page's heading band (Home). The menu and the
 * page are siblings inside PortalLayout, so a tiny store is simpler than threading state through
 * every page.
 */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

export const openAccountSheet = () => set(true);
export const closeAccountSheet = () => set(false);
export const isAccountSheetOpen = () => open;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** [open, setOpen] — for the sheet's owner. */
export function useAccountSheet(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, isAccountSheetOpen, isAccountSheetOpen);
  return [value, set];
}
