import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FOCUS } from './styles';

/**
 * TextLine: a one-line box for her own words. A visible label over a 56px input, tied to it; 16px text; `dir="auto"`
 * so an Urdu line and an English line each run their own way. `maxLength` is the limit; the message about it, if any,
 * is the page's, tied by `describedBy`. First used by the lesson-plan survey bar ("What was wrong").
 */
export interface TextLineProps {
  value: string;
  onChange: (text: string) => void;
  label: ReactNode;
  maxLength: number;
  describedBy?: string;
  testId?: string;
  className?: string;
}

export function TextLine({ value, onChange, label, maxLength, describedBy, testId, className }: TextLineProps) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[16px] font-semibold text-[#1d2025]">{label}</label>
      <input
        id={id}
        type="text"
        dir="auto"
        autoComplete="off"
        value={value}
        maxLength={maxLength}
        aria-describedby={describedBy}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className={cn('min-h-[56px] w-full rounded-[14px] border-[1.5px] border-[#d1d5db] bg-white px-4 text-[16px] text-[#1d2025]', FOCUS)}
      />
    </div>
  );
}
