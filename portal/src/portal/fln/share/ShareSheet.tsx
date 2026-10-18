/**
 * bd-t7zk3t.12 — "Share link" (DESIGN v2 §4 L2b): the plan card, Send on WhatsApp (wa.me → the contact picker, the
 * message from message.ts), Copy link (the clipboard with ShareActions' in-app-browser fallback) and the link shown in
 * full as one left-to-right atom. Logs `share` / `link_copy`, fire-and-forget. The link carries no identity.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../../teacher/ui/styles';
import { copyText } from '../../teacher/ui/ShareActions';
import { shareApi } from './api';
import { shareMessage, waUrl } from './message';
import { PlanCard, type SharePlan } from './PlanCard';
import { Sheet } from './Sheet';
import { shareStrings, type ShareLang } from './strings.share';

export const WA_GREEN = '#09883F';
export const BTN = 'flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[14px] border-2 px-4 py-2 text-[17px] font-bold leading-tight';

/** The copy button's states: idle → copied ✓ (a toast) | failed (the hold-to-copy hint). */
export function useCopyLink(url: string, plan: number) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback(async () => {
    let ok = false;
    try { ok = await copyText(url); } catch { ok = false; }
    setState(ok ? 'copied' : 'failed');
    if (ok) shareApi.event('link_copy', plan);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2500);
  }, [url, plan]);
  return { state, copy };
}

export function Toast({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
      <span className="rounded-full bg-[#1f2333] px-5 py-3 text-[16px] font-bold text-white shadow-lg">{text}</span>
    </div>
  );
}

export default function ShareSheet({ plan, url, lang, onClose }: { plan: SharePlan; url: string; lang: ShareLang; onClose: () => void }) {
  const S = shareStrings(lang);
  const { state, copy } = useCopyLink(url, plan.id);
  const href = waUrl(shareMessage({ uiLang: lang, subject: plan.subject, level: plan.level, title: plan.title, url }));
  return (
    <Sheet lang={lang} title={S.shareTitle} onClose={onClose} testId="fln-share-sheet">
      <PlanCard plan={plan} lang={lang} />
      <div className="rounded-[12px] bg-[#f3f4f6] px-3 py-3">
        <span className="sr-only">{S.theLink}</span>
        <p data-testid="fln-share-url" dir="ltr" className="fln-ltr-atom font-mono text-[15px] leading-snug text-[#1f2333]">{url}</p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => shareApi.event('share', plan.id)}
        style={{ backgroundColor: WA_GREEN, borderColor: WA_GREEN }}
        className={cn(BTN, 'text-white', FOCUS)}
      >
        {S.sendOnWhatsapp}
      </a>
      <button type="button" onClick={copy} className={cn(BTN, 'border-[#333748] bg-white text-[#333748]', FOCUS)}>
        {state === 'copied' ? <Check className="h-5 w-5" aria-hidden="true" /> : <Link2 className="h-5 w-5" aria-hidden="true" />}
        <span>{S.copyLink}</span>
      </button>
      {state === 'failed' ? <p role="alert" className="text-[15px] text-[#7a271a]">{S.copyFailed}</p> : null}
      {state === 'copied' ? <Toast text={S.linkCopied} /> : null}
    </Sheet>
  );
}
