import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isNativeApp } from '@/lib/runtime';
import api from '../../services/api';
import { useCopy, useLang } from '../i18n';
import { REMIND } from '../remind/copy';
import { CARD, FOCUS, OUTLINE_WIDE, PRIMARY_WIDE } from '../ui/styles';

/**
 * The teacher Home's "Evening reminder" (switch portal_push_remind, OFF by default): one web-push reminder at 6 pm
 * with tomorrow's plan. Drawn only where web push can work — not the NIETE app (isNativeApp), not an in-app browser
 * (WhatsApp, Facebook, Instagram, an Android WebView), and only with PushManager — AND only when the server says
 * {portal:true} (GET /api/portal/push/state; its 404 = off). Anything else draws nothing.
 *
 * Turn on (the tap is the only caller of requestPermission): permission → /sw.js at scope / (the edge serves it on
 * every host) → ready → pushManager.subscribe with the VAPID key (GET /api/wqpush/key) → POST /api/portal/push/subscribe
 * {sub, lang}. Turn off: POST unsubscribe, then sub.unsubscribe(). "Send one now" only with state.test, once on.
 * The server adds who the teacher is from the session; nothing here names them.
 */
export const IAB_RX = /\bWA4A\/|WhatsApp|FBAN|FBAV|Instagram|; wv\)/;

/** Can this browser take the reminder at all? (Asked before the server is.) */
export function canRemindHere(): boolean {
  if (isNativeApp()) return false;
  if (typeof window === 'undefined' || !('PushManager' in window)) return false;
  return !IAB_RX.test(String(typeof navigator !== 'undefined' ? navigator.userAgent : ''));
}

/** A base64url VAPID key as the bytes pushManager.subscribe wants. */
function keyBytes(b64url: string): Uint8Array {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

type State = { test: boolean };

export function RemindCard() {
  const C = useCopy(REMIND);
  const lang = useLang();
  const [state, setState] = useState<State | null>(null);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canRemindHere()) return undefined;
    let live = true;
    api.get('/push/state')
      .then(async ({ data }) => {
        if (!live || !data || data.portal !== true) return;
        // A phone that already holds the reminder shows "Turn off".
        let held: PushSubscription | null = null;
        try {
          const reg = await navigator.serviceWorker?.getRegistration?.('/');
          held = (await reg?.pushManager?.getSubscription()) ?? null;
        } catch { held = null; }
        if (!live) return;
        setSub(held);
        setState({ test: data.test === true });
      })
      .catch(() => { /* off (404) or unreadable: nothing drawn */ });
    return () => { live = false; };
  }, []);

  if (!state) return null;

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const reg = await navigator.serviceWorker.ready;
      const res = await fetch('/api/wqpush/key', { credentials: 'same-origin' });
      if (!res.ok) return;
      const { key } = (await res.json()) as { key?: string };
      if (!key) return;
      const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      await api.post('/push/subscribe', { sub: fresh.toJSON(), lang });
      setSub(fresh);
    } catch {
      /* stays off; the teacher can tap again */
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (busy || !sub) return;
    setBusy(true);
    try {
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe().catch(() => false);
      setSub(null);
    } finally {
      setBusy(false);
    }
  };

  const sendTest = () => {
    if (!sub) return;
    void api.post('/push/test', { endpoint: sub.endpoint }).catch(() => undefined);
  };

  return (
    <section aria-label={C.title} data-testid="remind-card" className={cn(CARD, 'flex flex-col gap-3 p-4')}>
      <h2 className="m-0 flex items-center gap-2 text-[18px] font-semibold leading-snug">
        <BellRing className="h-5 w-5 shrink-0 text-[#33374a]" strokeWidth={2.2} aria-hidden="true" />
        {C.title}
      </h2>
      <p className="m-0 text-[15px] leading-relaxed text-[#374151]">{C.body}</p>
      {sub ? (
        <button type="button" onClick={() => void turnOff()} disabled={busy} className={cn(OUTLINE_WIDE, FOCUS)}>{C.turnOff}</button>
      ) : (
        <button type="button" onClick={() => void turnOn()} disabled={busy} className={cn(PRIMARY_WIDE, FOCUS)}>{C.turnOn}</button>
      )}
      {sub && state.test && (
        <button type="button" onClick={sendTest} className={cn(OUTLINE_WIDE, FOCUS)}>{C.test}</button>
      )}
    </section>
  );
}
