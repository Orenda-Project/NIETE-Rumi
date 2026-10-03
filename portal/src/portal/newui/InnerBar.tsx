import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KIT_COPY } from './copy';
import { FeatureIcon, type Feature } from './FeatureIcon';
import { FOCUS, TAP_SQUARE } from './styles';

/**
 * bd-5rz1v.19 — the heading of a page INSIDE a flow: a LIGHT bar, white with a 1px bottom line.
 *
 *   (←)  [icon] Training · NIETE · Level 2      ← 12px muted breadcrumb, icon in the feature's hue
 *        Group Work                             ← 20px/800 title
 *
 * deep-screens.html `.ihead`/`.itop`: 6px 14px 12px, 12px gaps, 12px above the content; the
 * back button a 40px soft indigo-tint circle — here inside a 56px target, its arrow turned
 * round in RTL. Desktop (`.dlight`): 12px 40px, centred at 1120px, a 24px title.
 *
 * Back goes to the previous page when there is one. With nothing behind (she opened a link
 * straight to this page) it goes to `backTo`, replacing this entry so Back does not bounce.
 * Android's hardware Back is BackButtonHandler's job and does the same.
 */
export interface InnerBarProps {
  feature: Feature;
  /** "Home", "Training · NIETE · Level 2" — where she came from. */
  crumb: string;
  title: string;
  /** Where Back goes when there is no page behind this one. */
  backTo?: string;
  /** Replaces the default back behaviour. */
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}

export function InnerBar({ feature, crumb, title, backTo, onBack, backLabel = KIT_COPY.back, right }: InnerBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const back = () => {
    if (onBack) return onBack();
    // React Router gives the first entry of a fresh history the key "default": nothing behind it.
    if (location.key === 'default' && backTo) navigate(backTo, { replace: true });
    else navigate(-1);
  };

  return (
    <header data-testid="newui-inner-bar" className="mb-3 border-b border-nu-inner-border bg-nu-inner pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-[1120px] items-center gap-3 px-[14px] pb-3 pt-1.5 md:px-10 md:py-3">
        <button
          type="button"
          onClick={back}
          aria-label={backLabel}
          className={cn('-m-2 flex shrink-0 items-center justify-center rounded-full', TAP_SQUARE, FOCUS)}
        >
          <span data-circle className="flex h-10 w-10 items-center justify-center rounded-full bg-nu-inner-back text-nu-inner-back-icon">
            <ChevronLeft className="h-[22px] w-[22px] rtl:-scale-x-100" aria-hidden="true" />
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <p
            data-testid="newui-crumb"
            className="flex min-w-0 items-center gap-[5px] truncate text-xs font-bold text-nu-inner-crumb rtl:text-[12.5px] rtl:font-semibold rtl:leading-[1.9]"
          >
            <FeatureIcon feature={feature} className="h-3.5 w-3.5" />
            <span className="truncate">{crumb}</span>
          </p>
          <h1 className="truncate text-xl font-extrabold text-nu-surface-text rtl:text-[19px] rtl:font-bold rtl:leading-[1.9] md:text-2xl">
            {title}
          </h1>
        </div>
        {right ? <div className="-my-2 flex shrink-0 items-center">{right}</div> : null}
      </div>
    </header>
  );
}
