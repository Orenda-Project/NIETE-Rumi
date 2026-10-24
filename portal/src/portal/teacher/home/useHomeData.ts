import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { readConfigShared } from '../../lib/useNewUi';
import { getPortalOrigin, isNativeApp } from '@/lib/runtime';
import { fetchHome, tapHome, type HomeData, type HomeTileKey, type TapKind } from './api';

/**
 * The Home card's data and switches (the build contract, §3 "Loading").
 *
 * Switches: portal_teacher_home_card / portal_teacher_home_order / portal_teacher_home_look, read from the SAME shared
 * /config read as useTeacherV2 (`cfg.features.teacherHomeCard`, `.teacherHomeOrder`, `.teacherHomeLook`). Fail-CLOSED:
 * only a real `true` is on; while /config is read, or when it cannot be read, all are off and Home is exactly today's
 * (the one exception, by one paint: a look this user last had ON, see useHomeSwitches).
 *
 * Loading, kept simple on purpose: the tiles paint at once in the fixed order; ONE GET /me/home, started with /config. The card and
 * the chips are drawn whenever it answers (they sit between rows, so nothing above row 1 jumps for the slim card).
 * The fetched tile ORDER is applied only when it lands within REORDER_BUDGET_MS of the first paint AND before her
 * first tap, key or scroll; otherwise this load keeps the order it painted, and the fetched order (remembered in
 * memory and in localStorage for this user, so a cold open from a WhatsApp link has it too) is the starting order of
 * the next Home load. Home mounts before /config answers, so the starting order is taken when the switches arrive.
 */
export const REORDER_BUDGET_MS = 300;
/** The longest a quiz-home tap waits for its log before the page load. */
export const TAP_WAIT_MS = 400;

export type HomeSwitches = { card: boolean; order: boolean; look: boolean };
const OFF: HomeSwitches = { card: false, order: false, look: false };

/**
 * The look's last answer for this user, so a cold open with the look ON does not paint today's Home for one frame
 * first. Only an ON is stored; /config's answer always wins when it lands, and an off (or a failed read) clears it.
 * A teacher who never had the look has no key, so their first paint is today's.
 */
const lookKey = (userKey: string) => `teacher-home-look:v1:${userKey}`;

function recallLook(userKey?: string | null): boolean {
  if (!userKey) return false;
  try { return localStorage.getItem(lookKey(userKey)) === '1'; } catch { return false; }
}

function rememberLook(userKey: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(lookKey(userKey), '1');
    else localStorage.removeItem(lookKey(userKey));
  } catch { /* no store: the next open waits for /config */ }
}

/** A remembered look starts with the card on too: the server only ever answers the look with the card. */
const startFor = (userKey?: string | null): HomeSwitches => (recallLook(userKey) ? { card: true, order: false, look: true } : OFF);

const same = (a: HomeSwitches, b: HomeSwitches) => a.card === b.card && a.order === b.order && a.look === b.look;

/**
 * The Home switches for this user; all off until /config answers, except a look this user last had ON (see above).
 * @param userKey whose remembered look to use (memory and this device's store; nothing is read or written without it)
 */
export function useHomeSwitches(userKey?: string | null): HomeSwitches {
  return useSwitches(userKey, true);
}

/**
 * The look's switch alone, for the menu: the same shared /config read and the same remembered value as Home.
 * @param userKey whose remembered look to use (as useHomeSwitches)
 * @param enabled false for a reader that never has the look (a coach's menu): nothing is read, always off
 */
export function useHomeLook(userKey?: string | null, enabled = true): boolean {
  return useSwitches(userKey, enabled).look;
}

function useSwitches(userKey: string | null | undefined, enabled: boolean): HomeSwitches {
  const [sw, setSw] = useState<HomeSwitches>(() => (enabled ? startFor(userKey) : OFF));
  const answered = useRef(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    // The user can arrive after the first render: take their remembered look if /config has not answered yet.
    if (!answered.current) { const s = startFor(userKey); if (s.look) setSw(s); }
    readConfigShared()
      .then((cfg) => {
        const f = (cfg?.features ?? {}) as { teacherHomeCard?: unknown; teacherHomeOrder?: unknown; teacherHomeLook?: unknown };
        const card = f.teacherHomeCard === true;
        // The order and the look are read only when the card's switch is on (the build contract).
        return { card, order: card && f.teacherHomeOrder === true, look: card && f.teacherHomeLook === true };
      })
      .catch(() => OFF)
      .then((v) => {
        if (!live) return;
        answered.current = true;
        if (userKey) rememberLook(userKey, v.look);
        setSw((prev) => (same(prev, v) ? prev : v));
      });
    return () => { live = false; };
  }, [userKey, enabled]);
  return enabled ? sw : OFF;
}

/** The last order the server gave this user, so a late answer still counts on the next load (and the next page). */
let remembered: { userKey: string; order: HomeTileKey[] } | null = null;

const TILE_KEYS: readonly HomeTileKey[] = ['lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes', 'analytics'];
const orderKey = (userKey: string) => `teacher-home-order:v1:${userKey}`;

/** Memory first, then this device's store; a junk or blocked store is no order. */
function recall(userKey: string): HomeTileKey[] | null {
  if (remembered?.userKey === userKey) return remembered.order;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(orderKey(userKey)) || 'null');
    if (Array.isArray(parsed) && parsed.length === TILE_KEYS.length && parsed.every((k) => TILE_KEYS.includes(k))) {
      return parsed as HomeTileKey[];
    }
  } catch { /* no store: no order */ }
  return null;
}

function remember(userKey: string, order: HomeTileKey[]): void {
  remembered = { userKey, order };
  try { localStorage.setItem(orderKey(userKey), JSON.stringify(order)); } catch { /* memory still has it */ }
}

export type HomeState = {
  data: HomeData | null;
  /** The tile order to draw, or null for Home's fixed order. */
  order: HomeTileKey[] | null;
};

/**
 * @param on      the card switch (nothing is read when it is off)
 * @param orderOn the order switch
 * @param userKey whose remembered order to use (her phone number, memory only)
 */
export function useHomeData(on: boolean, orderOn: boolean, userKey?: string | null): HomeState {
  const [data, setData] = useState<HomeData | null>(null);
  const [order, setOrder] = useState<HomeTileKey[] | null>(() => (orderOn && userKey ? recall(userKey) : null));
  const painted = useRef(Date.now());
  const touched = useRef(false);

  // Her first interaction ends the window in which the tiles may still move.
  useEffect(() => {
    if (!on) return undefined;
    const stop = () => { touched.current = true; };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, stop, { capture: true, passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, stop, { capture: true }));
  }, [on]);

  // The switches arrive after the first render: start from the remembered order then (nothing has been tapped yet).
  useEffect(() => {
    if (on && orderOn && userKey && !touched.current) setOrder((o) => o ?? recall(userKey));
  }, [on, orderOn, userKey]);

  // A cold open: /me/home starts with /config (the card's switch arrives with it), not after it. Nothing reads it until the
  // switch is on; a teacher whose card is off gets one answer that nothing draws.
  const early = useRef<{ userKey: string; read: Promise<HomeData | null> } | null>(null);
  useEffect(() => {
    if (userKey && early.current?.userKey !== userKey) early.current = { userKey, read: fetchHome() };
  }, [userKey]);

  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const mine = early.current?.userKey === userKey ? early.current.read : null;
    early.current = null;
    (mine ?? fetchHome()).then((d) => {
      if (!live || !d) return;
      setData(d);
      if (!orderOn || !d.orderOn) return;
      if (userKey) remember(userKey, d.order);
      const inTime = Date.now() - painted.current <= REORDER_BUDGET_MS && !touched.current;
      if (inTime) setOrder(d.order);
    });
    return () => { live = false; };
  }, [on, orderOn, userKey]);

  return { data, order: on ? order : null };
}

/** A path outside the portal's router: the signed quiz home (same host as the portal). */
const isQuizHome = (href: string) => href.startsWith('/quiz/');

/**
 * Log the tap, then go. The quiz home lives outside the SPA router, so it is a page load (window.location.assign);
 * in the Android app the WebView serves from localhost, so the path is put on the portal's own origin there. Every
 * other target is a portal route (the router's navigate).
 */
export function useHomeGo(): (kind: TapKind, href: string) => void {
  const navigate = useNavigate();
  return useCallback((kind: TapKind, href: string) => {
    const logged = tapHome(kind);
    if (isQuizHome(href)) {
      // A page load cancels the log's request in flight, so leave once it is sent, or after TAP_WAIT_MS at most.
      const origin = isNativeApp() ? getPortalOrigin() : null;
      const leave = () => window.location.assign(origin ? `${origin}${href}` : href);
      void Promise.race([logged, new Promise<void>((r) => { setTimeout(r, TAP_WAIT_MS); })]).then(leave, leave);
      return;
    }
    navigate(href);
  }, [navigate]);
}

/** Tests only: forget every remembered look on this device. */
export function resetHomeLookMemory(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('teacher-home-look:v1:')).forEach((k) => localStorage.removeItem(k));
  } catch { /* no store */ }
}

/** Tests only: forget the remembered order. */
export function resetHomeOrderMemory(opts: { keepStored?: boolean } = {}): void {
  remembered = null;
  if (opts.keepStored) return;
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('teacher-home-order:v1:')).forEach((k) => localStorage.removeItem(k));
  } catch { /* no store */ }
}
