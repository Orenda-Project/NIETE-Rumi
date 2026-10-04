import { useEffect, useState } from 'react';
import { portal } from '../services/api';
import { forgetNewUi, rememberedNewUiFor, rememberNewUi } from './newUiMemory';

/**
 * bd-5rz1v.12 — is the new UI (Direction B) on for this user?
 *
 * Read like every other portal flag (useChildTest, useSelfObservation): null
 * while /config is read, then true only for a real `true`. Fail-CLOSED: an
 * unreadable config, or a client that throws, is "off", and the pages show
 * exactly what everyone had before.
 *
 * One difference: it remembers the last answer for the SAME user. Every page
 * mounts its own layout and navigation, so without this a pilot user would see
 * the old menu for a moment before the new one on every tap. The remembered
 * answer is only a starting point — /config is still read on every mount, and
 * a fresh "off" replaces a remembered "on". It is never carried to another user.
 *
 * `userKey` identifies whose answer it is. The portal's user payload carries no
 * id, so the navigation passes her phone number; it is held in memory only and
 * never stored. Without a key nothing is remembered.
 */
/**
 * The layout and the navigation both ask on every page; they share one /config
 * read while it is in flight. Fail-closed: a client that throws synchronously,
 * or a failed read, is "off".
 */
let inflight: Promise<boolean> | null = null;
function readNewUi(): Promise<boolean> {
  if (!inflight) {
    inflight = Promise.resolve()
      .then(() => portal.getConfig())
      .then((cfg) => cfg?.features?.newUi === true)
      .catch(() => false)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * @param userKey whose answer to remember (her phone number; memory only)
 * @param ready   false while the caller cannot ask yet — the layout waits for
 *                the user to load, so it does not read /config twice per page
 */
export function useNewUi(userKey?: string | null, ready = true): boolean | null {
  const [on, setOn] = useState<boolean | null>(() => rememberedNewUiFor(userKey));

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    const settle = (value: boolean) => {
      if (userKey) rememberNewUi(userKey, value);
      if (live) setOn(value);
    };
    readNewUi().then(settle);
    return () => { live = false; };
  }, [userKey, ready]);

  return on;
}

/** Tests only: forget the remembered answer. */
export function resetNewUiMemory(): void {
  forgetNewUi();
  inflight = null;
}
