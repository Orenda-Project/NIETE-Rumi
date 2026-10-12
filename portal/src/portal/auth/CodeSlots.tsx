import { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * bd-fmf24g.64 — the 6-digit code, drawn as six slots but kept as ONE real input laid over them: paste, the browser's
 * `one-time-code` autofill (the WhatsApp code arrives as a suggestion), the number keyboard and the screen reader all
 * work on a single field. The slots are decoration (aria-hidden); the input is the 62px-tall target.
 * The row is left-to-right in Urdu too: digits do not mirror.
 */
export interface CodeSlotsProps {
  id: string;
  label: string;
  value: string;
  onChange: (digits: string) => void;
  error?: string | null;
  disabled?: boolean;
}

const LENGTH = 6;

export function CodeSlots({ id, label, value, onChange, error, disabled }: CodeSlotsProps) {
  const errId = `${useId()}-err`;
  const [focused, setFocused] = useState(false);
  const at = Math.min(value.length, LENGTH - 1);
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-2 block px-0.5 text-base font-semibold leading-[1.2] rtl:mb-0.5 rtl:leading-normal">{label}</label>
      <div className="relative h-[62px]" dir="ltr">
        <div aria-hidden="true" className="flex h-full gap-2">
          {Array.from({ length: LENGTH }, (_, i) => (
            <div
              key={i}
              data-slot={value[i] ? 'filled' : 'empty'}
              className={cn(
                'flex h-full min-w-0 flex-1 items-center justify-center rounded-[14px] bg-nu-surface-card text-[26px] font-bold',
                error ? 'border-2 border-nu-button-destructive' : 'border-[1.5px] border-nu-surface-line',
                focused && !error && i === at && 'border-2 border-nu-ink ring-[3px] ring-nu-ink-light',
              )}
            >
              {value[i] ?? ''}
            </div>
          ))}
        </div>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={LENGTH}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, LENGTH))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className="absolute inset-0 h-[62px] w-full cursor-text bg-transparent text-transparent opacity-0 outline-none"
        />
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
