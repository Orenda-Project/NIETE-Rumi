import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ExternalLink, Link2, Lock, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { browserEnv, type BrowserEnv } from '@/lib/runtime';
import { FOCUS } from './styles';
import { useKitCopy } from './useKitCopy';
import type { ShareCopy } from './copy';

/**
 * bd-fmf24g.30 — ShareActions: THE pair of buttons for anything she can take out of the app (Blueprint: ShareActions).
 *
 *   Send on WhatsApp      WhatsApp green #09883F (white text 4.56:1) with the WhatsApp glyph, full width, 64px. ONE billed
 *                         message per press, so it is deliberate: off while sending; "sent" is final until she taps the
 *                         quiet "Send again". States: default · sending · sent ✓ + the time · failed (the whole button is
 *                         Try again) · unavailable (grey, locked, "Not available yet": no template on this deployment).
 *   Open in another app   white, navy outline, same size. Where she is decides what it does:
 *                           WhatsApp's browser on Android  an intent:// link → the phone's browser or the NIETE app;
 *                                                          nothing happened after 2 s → it becomes Copy link
 *                           WhatsApp's browser on iPhone   Copy link + a hint (a page cannot leave that browser)
 *                           Chrome, Safari, a desktop      hidden for a page; for a FILE it opens the file
 *                           the NIETE app                  hidden for a page; for a FILE it opens it in the system browser
 *
 * Both are 64px tall in every state and language, so nothing moves when a state changes. Put it in TeacherPage's `dock`.
 * `onSend` omitted = no Send button; `open` omitted = no Open button. Words: the kit's `share` (a screen may override).
 *
 * A PAGE opened outside WhatsApp's browser has no session (cookies do not cross), so it lands on the sign-in page until
 * the hand-off link area exists (bd-fmf24g.30 step 4, on hold). `PAGE_HANDOFF` keeps page targets off until then; a FILE
 * target is a presigned link and needs no sign-in.
 */
export const PAGE_HANDOFF = false;
const INTENT_WAIT_MS = 2000;

export type ShareResult = { status: 'sent'; at?: string } | { status: 'failed' } | { status: 'unavailable' };
export type OpenTarget =
  | { page: true }
  | { fileUrl: string | (() => Promise<string | null>) };

export interface ShareActionsProps {
  /** Sends the item as a WhatsApp template; resolves with the REAL result. Omit for no Send button. */
  onSend?: () => Promise<ShareResult>;
  /** false = no template on this deployment (grey, locked). null = still reading it (also grey: never invite a tap early). */
  available?: boolean | null;
  /** "Send to Ayesha" (the coach's Send the report page). */
  sendTo?: string;
  open?: OpenTarget;
  copy?: Partial<ShareCopy>;
  testId?: string;
  /** Test seams. */
  env?: BrowserEnv;
  pageHandoff?: boolean;
}

type SendState = 'default' | 'sending' | 'sent' | 'failed' | 'locked';
type OpenState = 'default' | 'opening' | 'copy' | 'copied' | 'failed';

const WA_GREEN = '#09883F';
const BASE = 'relative flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-2 px-[18px] py-1 text-[18px] font-bold leading-tight rtl:leading-[1.9]';

/** The intent link: the phone's own handler for this https URL (the NIETE app if it claims the path, else the default browser). */
export function intentUrl(url: string): string {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** "3:42" + the kit's AM/PM word, in Pakistan time (the portal's clock for every stamp). */
export function clockOf(iso: string | undefined, am: string, pm: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Asia/Karachi' }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h >= 12 ? pm : am}`;
}

async function copyText(text: string): Promise<boolean> {
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

function Label({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-px text-center">
      <span>{children}</span>
      {sub ? <span className="text-[13px] font-semibold leading-tight rtl:leading-[1.7]">{sub}</span> : null}
    </span>
  );
}

export function ShareActions({ onSend, available = true, sendTo, open, copy, testId, env: envProp, pageHandoff = PAGE_HANDOFF }: ShareActionsProps) {
  const words = { ...useKitCopy().share, ...copy } as ShareCopy;
  const kit = useKitCopy();
  const env = envProp ?? browserEnv();
  const locked = available !== true;
  const [send, setSend] = useState<SendState>('default');
  const [at, setAt] = useState<string | undefined>(undefined);
  const [openState, setOpenState] = useState<OpenState>('default');
  const alive = useRef(true);
  const sending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const press = useCallback(async () => {
    if (!onSend || sending.current) return; // one press = one message: a second tap while sending is ignored
    sending.current = true;
    setSend('sending');
    let result: ShareResult;
    try { result = await onSend(); } catch { result = { status: 'failed' }; }
    sending.current = false;
    if (!alive.current) return;
    if (result.status === 'sent') { setAt(result.at); setSend('sent'); } else if (result.status === 'unavailable') setSend('locked');
    else setSend('failed');
  }, [onSend]);

  // ---- Open in another app
  const fileUrl = open && 'fileUrl' in open ? open.fileUrl : null;
  const isPage = !!open && 'page' in open;
  const showOpen = !!open && (isPage
    ? pageHandoff && (env === 'android-iab' || env === 'ios-iab')
    : true);
  const copyMode = env === 'ios-iab' && showOpen;

  const targetUrl = useCallback(async (): Promise<string | null> => {
    if (fileUrl) return typeof fileUrl === 'string' ? fileUrl : fileUrl();
    return typeof window !== 'undefined' ? window.location.href : null;
  }, [fileUrl]);

  const doCopy = useCallback(async () => {
    const url = await targetUrl();
    const ok = url ? await copyText(url) : false;
    if (alive.current) setOpenState(ok ? 'copied' : 'failed');
  }, [targetUrl]);

  const pressOpen = useCallback(async () => {
    if (openState === 'opening') return;
    if (copyMode || openState === 'copy' || openState === 'failed') { await doCopy(); return; }
    setOpenState('opening');
    let url: string | null = null;
    try { url = await targetUrl(); } catch { url = null; }
    if (!url) { if (alive.current) setOpenState('copy'); return; }
    if (env === 'android-iab') {
      let left = false;
      const gone = () => { left = true; };
      const onVis = () => { if (document.visibilityState === 'hidden') gone(); };
      window.addEventListener('pagehide', gone);
      window.addEventListener('blur', gone);
      document.addEventListener('visibilitychange', onVis);
      window.location.href = intentUrl(url);
      window.setTimeout(() => {
        window.removeEventListener('pagehide', gone);
        window.removeEventListener('blur', gone);
        document.removeEventListener('visibilitychange', onVis);
        if (!alive.current) return;
        // Nothing happened: WhatsApp kept the link (or there is no handler). Copy link is the way out.
        setOpenState(left ? 'default' : 'failed');
      }, INTENT_WAIT_MS);
      return;
    }
    // A file in Chrome, Safari or the app: open it normally (the app hands another host to the system browser).
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpenState('default');
  }, [copyMode, doCopy, env, openState, targetUrl]);

  if (!onSend && !showOpen) return null;

  const state: SendState = locked ? 'locked' : send;
  const sentAt = clockOf(at, kit.am, kit.pm);
  const sendLabel = sendTo ? words.sendTo(sendTo) : words.send;

  let sendButton: ReactNode = null;
  if (onSend) {
    const common = { type: 'button' as const, 'data-testid': 'share-send' };
    if (state === 'locked') {
      sendButton = (
        <button {...common} aria-disabled="true" disabled className={cn(BASE, 'cursor-not-allowed border-[#d1d5db] bg-[#f3f4f6] text-[#4b5563]', FOCUS)}>
          <Lock className="h-[26px] w-[26px] shrink-0" strokeWidth={2.4} aria-hidden="true" />
          <Label sub={words.notAvailable}>{sendLabel}</Label>
        </button>
      );
    } else if (state === 'sending') {
      sendButton = (
        <button {...common} aria-busy="true" aria-disabled="true" disabled style={{ backgroundColor: WA_GREEN, borderColor: WA_GREEN }} className={cn(BASE, 'cursor-progress text-white opacity-90', FOCUS)}>
          <WhatsAppGlyph />
          <Label>{words.sending}</Label>
          <i aria-hidden="true" className="absolute bottom-0 start-0 h-[5px] w-[45%] rounded-es-[14px] bg-white/80" />
        </button>
      );
    } else if (state === 'sent') {
      sendButton = (
        <button {...common} aria-disabled="true" disabled className={cn(BASE, 'cursor-default border-[#0B6B2E] bg-[#e7f7ec] text-[#0B6B2E]', FOCUS)}>
          <Check className="h-7 w-7 shrink-0" strokeWidth={3} aria-hidden="true" />
          <Label sub={sentAt}>{words.sent}</Label>
        </button>
      );
    } else if (state === 'failed') {
      sendButton = (
        <button {...common} onClick={press} className={cn(BASE, 'border-[#c8331f] bg-[#fef2f1] text-[#7a271a]', FOCUS)}>
          <RotateCcw className="h-7 w-7 shrink-0" strokeWidth={2.6} aria-hidden="true" />
          <Label sub={words.couldntSend}>{words.tryAgain}</Label>
        </button>
      );
    } else {
      sendButton = (
        <button {...common} onClick={press} style={{ backgroundColor: WA_GREEN, borderColor: WA_GREEN }} className={cn(BASE, 'text-white', FOCUS)}>
          <WhatsAppGlyph />
          <Label>{sendLabel}</Label>
        </button>
      );
    }
  }

  let openButton: ReactNode = null;
  if (showOpen) {
    const mode: OpenState = copyMode && openState === 'default' ? 'copy' : openState;
    const outline = 'border-[#33374a] bg-white text-[#33374a]';
    const common = { type: 'button' as const, onClick: pressOpen, 'data-testid': 'share-open' };
    if (mode === 'opening') {
      openButton = (
        <button {...common} aria-busy="true" className={cn(BASE, 'cursor-progress border-[#33374a] bg-[#f3f4f6] text-[#33374a]', FOCUS)}>
          <ExternalLink className="h-[26px] w-[26px] shrink-0" strokeWidth={2.4} aria-hidden="true" />
          <Label>{words.opening}</Label>
          <i aria-hidden="true" className="absolute bottom-0 start-0 h-[5px] w-[45%] rounded-es-[14px] bg-[#33374a]" />
        </button>
      );
    } else if (mode === 'copied') {
      openButton = (
        <button {...common} className={cn(BASE, 'border-[#6b7280] bg-[#eef0f3] text-[#33374a]', FOCUS)}>
          <Check className="h-[26px] w-[26px] shrink-0" strokeWidth={3} aria-hidden="true" />
          <Label sub={env === 'ios-iab' ? words.openInSafari : words.pasteIt}>{words.linkCopied}</Label>
        </button>
      );
    } else if (mode === 'copy' || mode === 'failed') {
      openButton = (
        <button {...common} className={cn(BASE, outline, FOCUS)}>
          <Link2 className="h-[26px] w-[26px] shrink-0" strokeWidth={2.4} aria-hidden="true" />
          <Label sub={mode === 'failed' ? words.couldntOpen : null}>{words.copyLink}</Label>
        </button>
      );
    } else {
      openButton = (
        <button {...common} className={cn(BASE, outline, FOCUS)}>
          <ExternalLink className="h-[26px] w-[26px] shrink-0" strokeWidth={2.4} aria-hidden="true" />
          <Label>{words.open}</Label>
        </button>
      );
    }
  }

  return (
    <div data-testid={testId ?? 'share-actions'} className="flex w-full flex-col gap-2.5">
      {onSend ? (
        <div className="flex flex-col gap-1">
          <div role="status" aria-live="polite" className="contents">{sendButton}</div>
          {state === 'sent' ? (
            <button type="button" data-testid="share-send-again" onClick={press} className={cn('flex min-h-[56px] w-full items-center justify-center text-[16px] font-semibold text-[#33374a] underline underline-offset-4', FOCUS)}>
              {words.sendAgain}
            </button>
          ) : null}
        </div>
      ) : null}
      {openButton}
    </div>
  );
}

/** The WhatsApp mark (simple-icons path, a solid glyph in the button's text colour). */
function WhatsAppGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
