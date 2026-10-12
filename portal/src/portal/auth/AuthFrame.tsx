import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import i18n from 'i18next';
import { ArrowLeft, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import nieteLogo from '@/assets/niete-logo.png';
import { DELETE_ACCOUNT_PATH, PRIVACY_POLICY_PATH } from '../lib/legalLinks';
import { NieteLattice } from '../teacher/icons/NieteLattice';
import { useCopy, useLang } from '../teacher/i18n';
import { FOCUS, TAP_SQUARE } from '../newui/styles';
import { AUTH } from './copy';

/**
 * bd-fmf24g.64 — ONE frame for the four signed-out pages (login, forgot password, enter code, first-time setup), in the
 * teacher app's look (v36_login-refresh): the Home hero's indigo band (the N mark, NIETE, the lattice fading toward the
 * words, a light title), one white card climbing 40px into it, and the legal footer Google Play wants reachable from
 * the one screen everyone sees (bd-3wb0s, keeps data-testid="login-legal-footer").
 *
 * The language pill names the language it switches TO in its own script. It changes THIS DEVICE only (i18n remembers
 * it in localStorage): she is not signed in, so nothing is written to her account (operator, 2026-10-12). After she
 * signs in, the app follows her stored preference as it always did.
 *
 * `dir`/`lang` are set here as well as on <html> (App.tsx), so the frame is right-to-left on its own and a test can
 * see it. Start/end spacing only; the number inputs set dir="ltr" themselves (AuthField).
 */
export interface AuthFrameProps {
  title: string;
  /** Shows the round back button in the band. */
  onBack?: () => void;
  children: ReactNode;
}

const MAX_COL = 'mx-auto w-full max-w-[460px] md:max-w-[480px]';

export function AuthFrame({ title, onBack, children }: AuthFrameProps) {
  const c = useCopy(AUTH);
  const lang = useLang();
  const switchTo = lang === 'ur' ? 'en' : 'ur';
  return (
    <div
      data-frame="auth"
      dir={lang === 'ur' ? 'rtl' : 'ltr'}
      lang={lang}
      className="flex min-h-screen flex-col bg-nu-surface text-nu-surface-text"
    >
      <header className="relative overflow-hidden bg-nu-ink pb-[72px] pt-[calc(14px+env(safe-area-inset-top))] text-white md:pb-[84px]">
        <NieteLattice className="absolute inset-y-0 end-0 w-[72%]" strength={0.5} />
        <div className={cn('relative px-5', MAX_COL)}>
          <div className="flex min-h-[56px] items-center justify-between">
            <div className="flex items-center gap-1.5">
              {onBack ? (
                <button type="button" onClick={onBack} aria-label={c.back} className={cn('-ms-3.5 flex items-center justify-center rounded-full', TAP_SQUARE, FOCUS)}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-nu-frame-translucent">
                    <ArrowLeft className="h-6 w-6 rtl:-scale-x-100" aria-hidden="true" />
                  </span>
                </button>
              ) : null}
              <img src={nieteLogo} alt={c.logoAlt} className={cn('h-11 w-11 object-contain', onBack ? '' : '-ms-1.5')} />
              <span dir="ltr" className="text-[17px] font-bold tracking-[0.14em]">{c.brand}</span>
            </div>
            <button
              type="button"
              onClick={() => { void i18n.changeLanguage(switchTo); }}
              aria-label={c.language}
              className={cn('flex items-center justify-center rounded-full', TAP_SQUARE, FOCUS)}
            >
              <span dir={switchTo === 'en' ? 'ltr' : undefined} className="flex h-11 items-center gap-2 rounded-full border-[1.5px] border-nu-frame-control-border bg-nu-frame-control px-4 text-[17px] font-semibold">
                <Globe className="h-5 w-5" aria-hidden="true" />
                <span lang={switchTo} className="font-urdu">{c.langTo}</span>
              </span>
            </button>
          </div>
          <h1 className="mt-[30px] break-words text-[34px] font-light leading-[1.15] tracking-[-0.015em] md:text-[38px] rtl:mt-2.5 rtl:font-normal rtl:leading-[1.6]">{title}</h1>
        </div>
      </header>

      <main className="relative -mt-10 px-4">
        <div className={MAX_COL}>
          <div className="rounded-[20px] bg-nu-surface-card px-5 pb-3.5 pt-[22px] shadow-nu-float md:rounded-3xl md:px-7 md:pb-4 md:pt-7">
            {children}
          </div>
        </div>
      </main>

      <div className="flex-1" />

      <p data-testid="login-legal-footer" className="flex flex-wrap items-center justify-center px-4 pb-5 pt-1.5 text-base font-medium text-nu-surface-muted">
        <Link to={PRIVACY_POLICY_PATH} className={cn('flex min-h-[56px] items-center underline underline-offset-4', FOCUS)}>{c.privacy}</Link>
        <span aria-hidden="true" className="whitespace-pre"> · </span>
        <Link to={DELETE_ACCOUNT_PATH} className={cn('flex min-h-[56px] items-center underline underline-offset-4', FOCUS)}>{c.deleteAccount}</Link>
      </p>
    </div>
  );
}

/** A plain message that is not about one field (too many tries, no connection, a dead link): under the button. */
export function AuthMessage({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'done' }) {
  return (
    <p
      role="alert"
      className={cn(
        'mb-3 flex items-center gap-2 px-0.5 text-base font-semibold rtl:mb-1',
        tone === 'error' ? 'text-nu-button-destructive' : 'text-nu-chip-done',
      )}
    >
      {children}
    </p>
  );
}
