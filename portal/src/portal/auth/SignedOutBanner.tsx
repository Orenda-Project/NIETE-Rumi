import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../newui/styles';
import { useCopy } from '../teacher/i18n';
import { AUTH } from './copy';

/**
 * The last moment the signed-out notice shows: the end of 25 Oct 2026, Pakistan time (UTC+5, no daylight saving).
 *
 * Why it exists: a server change signed many teachers and coaches out of the portal at once, and many then tried a
 * password they did not remember, when the page's own sign-in (a code on WhatsApp) needs none. The notice points them
 * to the code for the few days that follow.
 *
 * Why a date in the code and not a setting: it has to go away by itself, with no further release and no switch for
 * anyone to remember to turn off. After this moment the component renders nothing; it can then be deleted at leisure.
 */
export const SIGNED_OUT_NOTICE_UNTIL = Date.parse('2026-10-25T23:59:59.999+05:00');

export const signedOutNoticeShows = (now: number = Date.now()) => now <= SIGNED_OUT_NOTICE_UNTIL;

export interface SignedOutBannerProps {
  /** Given only while the password form shows: the tap that switches to the code sign-in. */
  onUseCode?: () => void;
  /** For tests; the clock otherwise. */
  now?: number;
}

/**
 * A calm notice at the top of the login card, above the form, in the page's language: plain information in the same
 * shape as the code step's "Sent on WhatsApp" row (the page's surface grey, the muted WhatsApp icon). Not dismissible,
 * and it sits in the flow of the card, so it never covers the form. On the password form it carries one link-style tap
 * to the code sign-in; on the code form it is text only.
 */
export function SignedOutBanner({ onUseCode, now }: SignedOutBannerProps) {
  const c = useCopy(AUTH);
  if (!signedOutNoticeShows(now)) return null;
  return (
    <div data-testid="signed-out-banner" className="mb-[22px] rounded-[14px] bg-nu-surface px-3.5 py-3">
      <p className="flex items-start gap-2.5 text-base font-semibold leading-[1.45] rtl:leading-[2]">
        <MessageCircle className="mt-0.5 h-[22px] w-[22px] shrink-0 text-nu-surface-muted rtl:mt-1.5" aria-hidden="true" />
        <span className="min-w-0 break-words">{c.signedOut}</span>
      </p>
      {onUseCode ? (
        <button
          type="button"
          onClick={onUseCode}
          className={cn(
            '-mb-1.5 flex min-h-[56px] items-center gap-2 px-0.5 text-base font-semibold text-nu-button underline underline-offset-4',
            FOCUS,
          )}
        >
          <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{c.byCode}</span>
        </button>
      ) : null}
    </div>
  );
}
