import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type NavItem = { key: string; to: string; label: ReactNode; icon: ReactNode; current: boolean; dataNav?: string };

/**
 * bd-sex15q.42 — the phone's bottom bar, ONE markup for the coach and the RM (DESIGN_SYSTEM §7): opaque white, above
 * every scrolled thing (z-50, the COS's 135247 fix), lucide 20 px line icons, the current item green with a green-ink
 * 11/600 label, 44 px targets and the safe area under it. Hidden on a laptop, where the Rail takes over.
 */
export function NavBar({ items, ariaLabel, testId }: { items: readonly NavItem[]; ariaLabel: string; testId: string }) {
  return (
    <nav
      aria-label={ariaLabel}
      data-testid={testId}
      className="cp fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-cp-hairline bg-white px-1.5 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-2px_8px_rgba(51,55,72,0.05)] lg:hidden"
    >
      {items.map(({ key, to, label, icon, current, dataNav }) => (
        <Link
          key={key}
          to={to}
          data-nav={dataNav}
          aria-current={current ? "page" : undefined}
          className={`flex min-h-[48px] min-w-[60px] flex-1 flex-col items-center justify-center gap-[3px] whitespace-nowrap rounded-xl text-[11px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green ${current ? "text-cp-green-ink [&_svg]:text-cp-green" : "text-cp-ink-3 [&_svg]:text-cp-ink-2"}`}
        >
          {icon}
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
