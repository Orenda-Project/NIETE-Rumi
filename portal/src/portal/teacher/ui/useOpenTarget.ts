import { useCallback, useEffect, useRef, useState } from 'react';
import { browserEnv, type BrowserEnv } from '@/lib/runtime';

/**
 * useOpenTarget — "Open in another app" as logic only, so one behaviour has two looks: ShareActions' 64px button and
 * ActionStrip's Download cell (lifted out of ShareActions, bd-fmf24g.30 / .53 / .59 / .60). Where she is decides what a
 * press does:
 *
 *   WhatsApp's browser, Android    a FILE goes to the phone's browser through OUR page (public/open-file.html, no .pdf
 *                                  in its link), which forwards to the file; `handOff`, with a quiet Copy link beside it
 *   WhatsApp's browser, iPhone     Copy link (`copyMode`); a page cannot leave it
 *   Chrome, Safari, a desktop      hidden for a page; for a FILE it opens the file
 *   the NIETE app                  hidden for a page; for a FILE it opens it in the system browser
 *
 * `mode` is the button's state (ShareActions draws one per state). `flash` is the state word a small surface shows in
 * place of its own word after a press (opening · copied · failed), held OPEN_HOLD_MS: nothing disappears in under 10 s.
 */
export type OpenTarget =
  | { page: true }
  | { fileUrl: string | (() => Promise<string | null>) };

export type OpenState = 'default' | 'opening' | 'copy' | 'copied' | 'failed';
export type OpenFlash = 'opening' | 'copied' | 'failed' | null;

/** The longest-lived state word: at least 10 s (the kit's "nothing disappears in under 10 s"). */
export const OPEN_HOLD_MS = 10_000;

/**
 * bd-fmf24g.60 — the hosts public/open-file.html forwards to (keep the two in step). A file anywhere else is not handed off:
 * its link is copied instead, so the page can never be used to send someone elsewhere.
 */
export const HANDOFF_HOST = /(^|\.)(r2\.cloudflarestorage\.com|r2\.dev|niete\.edu\.pk|up\.railway\.app)$/i;

function b64url(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * bd-fmf24g.60 — Android, WhatsApp's browser: "open this file in the phone's browser". WhatsApp's in-app browser sends any
 * link whose path ends in .pdf — even inside intent:// — to its own PDF viewer, which throws "unknown protocol: intent"
 * and takes WhatsApp down. So the browser gets OUR page, public/open-file.html, which has no .pdf in its link and
 * forwards to the file. No S.browser_fallback_url: nothing ever loads inside WhatsApp (bd-fmf24g.53). Null when the
 * file's host is not one that page forwards to.
 */
export function handoffIntentUrl(fileUrl: string, pageOrigin: string): string | null {
  let f: URL;
  try { f = new URL(fileUrl); } catch { return null; }
  if (f.protocol !== 'https:' || !HANDOFF_HOST.test(f.hostname)) return null;
  return `intent://${new URL(pageOrigin).host}/open-file.html?f=${b64url(f.href)}#Intent;scheme=https;end`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export interface OpenTargetOptions {
  /** Test seams. */
  env?: BrowserEnv;
  pageHandoff?: boolean;
}

export function useOpenTarget(open: OpenTarget | undefined, { env: envProp, pageHandoff = false }: OpenTargetOptions = {}) {
  const env = envProp ?? browserEnv();
  const [openState, setOpenState] = useState<OpenState>('default');
  const [copyState, setCopyState] = useState<'copy' | 'copied' | 'failed'>('copy');
  const [flash, setFlashState] = useState<OpenFlash>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  const setFlash = useCallback((f: Exclude<OpenFlash, null>) => {
    if (!alive.current) return;
    setFlashState(f);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (alive.current) setFlashState(null); }, OPEN_HOLD_MS);
  }, []);

  const fileUrl = open && 'fileUrl' in open ? open.fileUrl : null;
  const isPage = !!open && 'page' in open;
  const show = !!open && (isPage ? pageHandoff && (env === 'android-iab' || env === 'ios-iab') : true);
  // Android, WhatsApp's browser, a FILE: hand it to the phone's app (bd-fmf24g.59), with Copy link underneath.
  const handOff = env === 'android-iab' && show && !!fileUrl;
  // Anywhere else inside WhatsApp's browser the press only copies: nothing it can navigate to leaves WhatsApp.
  const copyMode = (env === 'ios-iab' || env === 'android-iab') && show && !handOff;

  const targetUrl = useCallback(async (): Promise<string | null> => {
    if (fileUrl) return typeof fileUrl === 'string' ? fileUrl : fileUrl();
    return typeof window !== 'undefined' ? window.location.href : null;
  }, [fileUrl]);

  const doCopy = useCallback(async () => {
    let url: string | null = null;
    try { url = await targetUrl(); } catch { url = null; }
    const ok = url ? await copyText(url) : false;
    if (alive.current) setOpenState(ok ? 'copied' : 'failed');
    setFlash(ok ? 'copied' : 'failed');
  }, [setFlash, targetUrl]);

  const pressCopy = useCallback(async () => {
    let url: string | null = null;
    try { url = await targetUrl(); } catch { url = null; }
    const ok = url ? await copyText(url) : false;
    if (alive.current) setCopyState(ok ? 'copied' : 'failed');
    setFlash(ok ? 'copied' : 'failed');
  }, [setFlash, targetUrl]);

  const run = useCallback(async () => {
    if (copyMode || openState === 'copy' || openState === 'failed') { await doCopy(); return; }
    setOpenState('opening');
    setFlash('opening');
    let url: string | null = null;
    try { url = await targetUrl(); } catch { url = null; }
    if (!url) {
      if (alive.current) setOpenState(handOff ? 'default' : 'copy');
      setFlash('failed');
      return;
    }
    if (handOff) {
      const to = handoffIntentUrl(url, new URL(window.location.href).origin);
      if (alive.current) setOpenState('default');
      if (to) window.location.href = to;
      else await pressCopy(); // a host our page does not forward to: copy its link instead of handing it off
      return;
    }
    // A file in Chrome, Safari or the app: open it normally (the app hands another host to the system browser).
    window.open(url, '_blank', 'noopener,noreferrer');
    if (alive.current) setOpenState('default');
  }, [copyMode, doCopy, handOff, openState, pressCopy, setFlash, targetUrl]);

  /** One press at a time: a second tap while it works is ignored. */
  const press = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try { await run(); } finally { busy.current = false; }
  }, [run]);

  const mode: OpenState = copyMode && openState === 'default' ? 'copy' : openState;
  return { env, show, handOff, copyMode, mode, copyState, flash, press, pressCopy };
}
