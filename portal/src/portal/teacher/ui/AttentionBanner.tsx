import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from './styles';

/**
 * bd-4404s7.1 — AttentionBanner: one line that says something is waiting ("2 reports waiting"). One component for every
 * "this needs you" notice (the coach's pending reports, a teacher's "Your turn"). Amber (the kit's waiting tone), a 56px
 * target, a clock at the start and a chevron at the end that turns round in Urdu. With `to` it is a link, with `onPress`
 * a button, with neither a plain status note. It never stacks with the ready banner: the host hides it meanwhile.
 * The words are the screen's (`text`, already counted: "2 reports waiting"). Canvas: AttentionBanner board.
 */
export interface AttentionBannerProps {
  text: ReactNode;
  to?: string;
  onPress?: () => void;
  testId?: string;
  className?: string;
}

const FRAME = 'flex min-h-[56px] w-full items-center gap-2.5 rounded-2xl bg-[#fef3c7] px-3.5 text-start text-[15px] font-semibold text-[#b45309]';

export function AttentionBanner({ text, to, onPress, testId, className }: AttentionBannerProps) {
  const inner = (
    <>
      <Clock className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      {to || onPress ? <ChevronRight className="h-5 w-5 shrink-0 rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" /> : null}
    </>
  );
  if (to) return <Link to={to} data-testid={testId} className={cn(FRAME, FOCUS, className)}>{inner}</Link>;
  if (onPress) return <button type="button" onClick={onPress} data-testid={testId} className={cn(FRAME, FOCUS, className)}>{inner}</button>;
  return <div role="status" data-testid={testId} className={cn(FRAME, className)}>{inner}</div>;
}
