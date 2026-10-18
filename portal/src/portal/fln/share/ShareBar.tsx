/**
 * The leaders' sticky Share bar on a plan page (DESIGN v2 §2 S4.7, §4 L1–L2b).
 *
 * Props `{plan, placement, me}`: the plan page (m-app, PR-C) fetches GET /api/portal/fln/me on every mount (no-store)
 * and passes it in, so the bar never asks or caches it itself. It renders NOTHING unless `me.share === true` (a teacher,
 * a missing `me`, a plan without a placement). For a leader: a bar ≤56 px at the bottom with two ≥48 px buttons,
 * **Send to teacher** (primary, opens the teacher sheet) and **Share link** (wa.me + Copy). The page's bottom padding
 * (64 px) is m-app's, so the page's last lines are never covered.
 */
import { useState } from 'react';
import { Link2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPortalOrigin } from '@/lib/runtime';
import { FOCUS } from '../../teacher/ui/styles';
import { sharePlanOf } from './PlanCard';
import SendSheet from './SendSheet';
import ShareSheet, { WA_GREEN } from './ShareSheet';
import { SHARE_DIR, shareStrings } from './strings.share';
import type { ShareMe, SharePlacementLike, SharePlanLike } from './types';
import './share.css';

const BAR_PX = 56;

/** The permanent, identity-free link to a plan (contracts/deep-link.md v2). */
export function planLink(id: number): string {
  const origin = (getPortalOrigin() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  return `${origin}/portal/fln/p/${id}`;
}

export default function ShareBar({ plan: planIn, placement, me }: {
  plan: SharePlanLike | null | undefined;
  placement: SharePlacementLike[] | null | undefined;
  me: ShareMe | null | undefined;
}) {
  const [open, setOpen] = useState<'none' | 'send' | 'share'>('none');
  const plan = sharePlanOf({ plan: planIn, placement });
  if (!me || me.share !== true || !plan) return null;
  const lang = me.ui_lang === 'ur' ? 'ur' : 'en';
  const S = shareStrings(lang);
  const url = planLink(plan.id);
  const button = 'flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[12px] border-2 px-3 text-[16px] font-bold leading-tight';
  return (
    <>
      <div
        data-testid="fln-share-bar"
        lang={lang}
        dir={SHARE_DIR[lang]}
        style={{ maxHeight: `${BAR_PX}px` }}
        className="fln-root fln-share-bar fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-[#e5e7eb] bg-white/95 px-3 py-1 shadow-[0_-4px_12px_rgba(16,24,40,0.08)] backdrop-blur"
      >
        <button type="button" onClick={() => setOpen('send')} style={{ backgroundColor: WA_GREEN, borderColor: WA_GREEN }} className={cn(button, 'text-white', FOCUS)}>
          <Send className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{S.sendToTeacher}</span>
        </button>
        <button type="button" onClick={() => setOpen('share')} className={cn(button, 'border-[#333748] bg-white text-[#333748]', FOCUS)}>
          <Link2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{S.shareLink}</span>
        </button>
      </div>
      {open === 'send' ? <SendSheet plan={plan} lang={lang} onClose={() => setOpen('none')} onShareLink={() => setOpen('share')} /> : null}
      {open === 'share' ? <ShareSheet plan={plan} url={url} lang={lang} onClose={() => setOpen('none')} /> : null}
    </>
  );
}
