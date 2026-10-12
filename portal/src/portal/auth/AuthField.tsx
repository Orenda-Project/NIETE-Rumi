import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../newui/styles';

/**
 * bd-fmf24g.64 — one field of the auth pages: a 16px/600 label, then a 58px box with a leading icon, the input, and (for
 * a password) a 56px show/hide button; under it, the message when something is wrong. The message is a role="alert"
 * row (red icon, 1-3 words) that the page keeps until she types in THIS field; it is the input's accessible
 * description, and the box's border turns red (aria-invalid).
 *
 * `ltr` is for a number (a phone, a code): the input stays left-to-right inside a right-to-left page and sits on the
 * reading side. Start/end spacing only. Every target is at least 56px (the input is 56px tall).
 */
export interface AuthFieldProps {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'tel' | 'password';
  placeholder?: string;
  error?: string | null;
  ltr?: boolean;
  inputMode?: 'text' | 'tel' | 'numeric';
  autoComplete?: string;
  disabled?: boolean;
  maxLength?: number;
  /** Follow the page's eye without a button of its own (the confirm box): the same flag as `eye.shown`. */
  shown?: boolean;
  /** A password's show/hide button. `shown` is the page's one flag, so two fields can follow one eye. */
  eye?: { shown: boolean; onToggle: () => void; showLabel: string; hideLabel: string };
}

export function AuthField({
  id, label, icon: Icon, value, onChange, type = 'text', placeholder, error, ltr, inputMode, autoComplete, disabled, maxLength, eye, shown,
}: AuthFieldProps) {
  const errId = `${useId()}-err`;
  const inputType = type === 'password' && (shown ?? eye?.shown) ? 'text' : type;
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-2 block px-0.5 text-base font-semibold rtl:mb-0.5">{label}</label>
      <div
        className={cn(
          'flex min-h-[58px] items-center gap-3 rounded-2xl bg-nu-surface-card px-4',
          error
            ? 'border-2 border-nu-button-destructive'
            : 'border-[1.5px] border-nu-surface-line focus-within:border-nu-ink focus-within:ring-1 focus-within:ring-nu-ink',
        )}
      >
        <Icon className="h-[22px] w-[22px] shrink-0 text-nu-surface-muted" aria-hidden="true" />
        <input
          id={id}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          dir={ltr ? 'ltr' : undefined}
          inputMode={inputMode}
          autoComplete={autoComplete}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={cn(
            'h-14 min-w-0 flex-1 bg-transparent text-lg font-medium text-nu-surface-text outline-none',
            'placeholder:font-normal placeholder:text-nu-surface-chevron disabled:opacity-60',
            ltr && 'rtl:text-end',
          )}
        />
        {eye ? (
          <button
            type="button"
            onClick={eye.onToggle}
            aria-label={eye.shown ? eye.hideLabel : eye.showLabel}
            className={cn('-me-4 flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-nu-surface-muted', FOCUS)}
          >
            {eye.shown ? <EyeOff className="h-6 w-6" aria-hidden="true" /> : <Eye className="h-6 w-6" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errId} role="alert" className="mt-2.5 flex items-center gap-2 px-0.5 text-base font-semibold text-nu-button-destructive rtl:mt-1">
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
