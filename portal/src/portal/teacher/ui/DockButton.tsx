import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FOCUS } from './styles';

/**
 * DockButton: the 56px button in a page's dock (TeacherPage `dock`), the Training pages' Mark done / Start quick check /
 * Continue. Indigo; `outline` for the second choice; grey while `disabled`. `to` makes it a link. Moved here unchanged
 * from teacher/training/parts.tsx (bd-rlxkkt.9) so a page outside Training (Coach Training's Mark done) can use it without
 * pulling in Training's certificate download; parts.tsx re-exports it, so its imports are unchanged.
 */
export function DockButton({
  children, icon: I, to, onClick, disabled, outline, testId, iconFlips,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  outline?: boolean;
  testId?: string;
  iconFlips?: boolean;
}) {
  const cls = cn(
    'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold',
    disabled ? 'bg-[#e5e7eb] text-[#9ca3af]' : outline ? 'border border-[#e5e7eb] bg-white text-[#1d2025]' : 'bg-[#33374a] text-white',
    FOCUS,
  );
  const icon = I ? <I className={cn('h-5 w-5', iconFlips && 'rtl:rotate-180')} strokeWidth={2.4} aria-hidden="true" /> : null;
  if (to && !disabled) return <Link to={to} data-testid={testId} className={cls}>{icon}{children}</Link>;
  return <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} className={cls}>{icon}{children}</button>;
}
